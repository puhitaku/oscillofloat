package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/puhitaku/oscillofloat/internal/auth"
	"github.com/puhitaku/oscillofloat/internal/store"
)

const (
	sessionA   = "session-aaaaaaaaaa"
	sessionB   = "session-bbbbbbbbbb"
	goodToken  = "good-token"
	validFrame = `{"frame":{"paths":[{"closed":false,"points":[{"x":0.1,"y":0.2},{"x":0.3,"y":0.25,"in":[0.2,0.3]}]}]}}`
)

type fakeVerifier struct{}

func (fakeVerifier) Verify(ctx context.Context, token string) error {
	if token != goodToken {
		return errors.New("bad token")
	}
	return nil
}

type env struct {
	t   *testing.T
	srv *Server
	ts  *httptest.Server
}

func newEnv(t *testing.T, cfg Config) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	cfg.Store = st
	if cfg.UploadRate == 0 {
		cfg.UploadRate = 1000
	}
	srv := New(cfg)
	ts := httptest.NewServer(srv)
	t.Cleanup(func() {
		srv.Close()
		ts.Close()
		st.Close()
	})
	return &env{t: t, srv: srv, ts: ts}
}

type response struct {
	status int
	header http.Header
	body   map[string]any
}

func (e *env) do(method, path string, header map[string]string, body string) response {
	e.t.Helper()
	req, err := http.NewRequest(method, e.ts.URL+path, strings.NewReader(body))
	if err != nil {
		e.t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		e.t.Fatal(err)
	}
	r := response{status: res.StatusCode, header: res.Header}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		e.t.Fatalf("%s %s: Content-Type %q, body %q", method, path, ct, data)
	}
	if err := json.Unmarshal(data, &r.body); err != nil {
		e.t.Fatalf("%s %s: body %q: %v", method, path, data, err)
	}
	return r
}

func (e *env) upload(session, body string) response {
	e.t.Helper()
	return e.do("POST", "/api/drawings", map[string]string{"X-Session-Id": session}, body)
}

func (e *env) mustUpload(session string) string {
	e.t.Helper()
	r := e.upload(session, validFrame)
	if r.status != http.StatusCreated {
		e.t.Fatalf("upload: %d %v", r.status, r.body)
	}
	return r.body["id"].(string)
}

func (e *env) adminIDs(header map[string]string) []string {
	e.t.Helper()
	r := e.do("GET", "/api/admin/drawings", header, "")
	if r.status != http.StatusOK {
		e.t.Fatalf("admin list: %d %v", r.status, r.body)
	}
	ids := []string{}
	for _, d := range r.body["drawings"].([]any) {
		ids = append(ids, d.(map[string]any)["id"].(string))
	}
	return ids
}

type socket struct {
	t    *testing.T
	conn *websocket.Conn
}

func (e *env) dial() *socket {
	e.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.ts.URL, "http")+"/ws", nil)
	if err != nil {
		e.t.Fatal(err)
	}
	e.t.Cleanup(func() { conn.CloseNow() })
	s := &socket{t: e.t, conn: conn}
	s.send(`{"type":"list"}`)
	if m := s.read(); m["type"] != "list" {
		e.t.Fatalf("first reply %v, want list", m)
	}
	return s
}

func (s *socket) send(msg string) {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.conn.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		s.t.Fatal(err)
	}
}

func (s *socket) read() map[string]any {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := s.conn.Read(ctx)
	if err != nil {
		s.t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		s.t.Fatalf("message %q: %v", data, err)
	}
	return m
}

func strs(v any) []string {
	out := []string{}
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func sorted(ids []string) []string {
	ids = slices.Clone(ids)
	slices.Sort(ids)
	return ids
}

func TestUploadIsStoredListedAndAnnounced(t *testing.T) {
	e := newEnv(t, Config{InsecureAdmin: true})
	ws := e.dial()

	r := e.upload(sessionA, validFrame)
	if r.status != http.StatusCreated {
		t.Fatalf("status %d %v", r.status, r.body)
	}
	id, _ := r.body["id"].(string)
	createdAt, _ := r.body["createdAt"].(string)
	if id == "" || createdAt == "" || len(r.body) != 2 {
		t.Fatalf("body %v, want id and createdAt", r.body)
	}

	if ids := e.adminIDs(nil); !slices.Equal(ids, []string{id}) {
		t.Errorf("admin list %v, want [%s]", ids, id)
	}

	m := ws.read()
	if m["type"] != "added" {
		t.Fatalf("message %v, want added", m)
	}
	d := m["drawing"].(map[string]any)
	if d["id"] != id || d["createdAt"] != createdAt {
		t.Errorf("added drawing %v, want id %s", d, id)
	}
	var want, got any
	json.Unmarshal([]byte(validFrame), &want)
	got = map[string]any{"frame": d["frame"]}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("added frame %v, want %v", got, want)
	}
}

func TestUploadRejectsInvalidBodies(t *testing.T) {
	e := newEnv(t, Config{})
	for name, body := range map[string]string{
		"no paths":        `{"frame":{"paths":[]}}`,
		"empty path":      `{"frame":{"paths":[{"points":[]}]}}`,
		"anchor outside":  `{"frame":{"paths":[{"points":[{"x":1.5,"y":0}]}]}}`,
		"handle outside":  `{"frame":{"paths":[{"points":[{"x":0,"y":0,"out":[3,0]}]}]}}`,
		"missing frame":   `{}`,
		"unknown field":   `{"frame":{"paths":[{"points":[{"x":0,"y":0}]}]},"extra":1}`,
		"unknown in path": `{"frame":{"paths":[{"points":[{"x":0,"y":0}],"color":"red"}]}}`,
		"not JSON":        `frame`,
		"empty":           ``,
		"trailing data":   validFrame + `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			r := e.upload(sessionA, body)
			if r.status != http.StatusBadRequest {
				t.Errorf("status %d, want 400", r.status)
			}
			if msg, _ := r.body["error"].(string); msg == "" {
				t.Errorf("body %v has no error message", r.body)
			}
		})
	}
	if r := e.upload(sessionA, `{"frame":{"paths":[]}}`); r.body["error"] != "no paths" {
		t.Errorf("error %v, want the validation message", r.body["error"])
	}
}

func TestUploadRejectsBodiesOverOneMebibyte(t *testing.T) {
	e := newEnv(t, Config{})
	body := `{"frame":{"paths":[{"points":[{"x":0,"y":0` + strings.Repeat(" ", 1<<20) + `}]}]}}`
	if r := e.upload(sessionA, body); r.status != http.StatusRequestEntityTooLarge {
		t.Errorf("status %d, want 413", r.status)
	}
}

func TestUploadAndDeleteRequireAValidSessionID(t *testing.T) {
	e := newEnv(t, Config{})
	for name, session := range map[string]string{
		"missing":     "",
		"too short":   "abcdefghijklmno",
		"too long":    strings.Repeat("a", 65),
		"bad chars":   "session-aaaa/aaaaa",
		"whitespace":  "session aaaaaaaaaa",
		"non-ASCII":   "session-ああああああああ",
		"dots":        "session.aaaaaaaaaa",
		"almost good": sessionA + "!",
	} {
		t.Run(name, func(t *testing.T) {
			if r := e.upload(session, validFrame); r.status != http.StatusBadRequest {
				t.Errorf("POST status %d, want 400", r.status)
			}
			r := e.do("DELETE", "/api/drawings", map[string]string{"X-Session-Id": session}, "")
			if r.status != http.StatusBadRequest {
				t.Errorf("DELETE status %d, want 400", r.status)
			}
		})
	}
	for _, ok := range []string{strings.Repeat("a", 16), strings.Repeat("Z_-9", 16)} {
		if r := e.upload(ok, validFrame); r.status != http.StatusCreated {
			t.Errorf("session %q: status %d, want 201", ok, r.status)
		}
	}
}

func TestUploadsAreRateLimitedPerClientAddress(t *testing.T) {
	e := newEnv(t, Config{UploadRate: 3})
	for i := range 3 {
		if r := e.upload(sessionA, validFrame); r.status != http.StatusCreated {
			t.Fatalf("upload %d: status %d", i+1, r.status)
		}
	}
	r := e.upload(sessionB, validFrame)
	if r.status != http.StatusTooManyRequests {
		t.Fatalf("4th upload: status %d, want 429", r.status)
	}
	if r.body["error"] == nil {
		t.Errorf("429 body %v has no error", r.body)
	}
	spoofed := e.do("POST", "/api/drawings", map[string]string{"X-Session-Id": sessionA, "X-Forwarded-For": "192.0.2.1"}, validFrame)
	if spoofed.status != http.StatusTooManyRequests {
		t.Errorf("X-Forwarded-For honoured without -trust-proxy: status %d", spoofed.status)
	}
}

func TestUploadsBehindAProxyAreLimitedByForwardedAddress(t *testing.T) {
	e := newEnv(t, Config{UploadRate: 1, TrustProxy: true})
	from := func(xff string) int {
		return e.do("POST", "/api/drawings", map[string]string{"X-Session-Id": sessionA, "X-Forwarded-For": xff}, validFrame).status
	}
	if s := from("203.0.113.9, 192.0.2.1"); s != http.StatusCreated {
		t.Fatalf("first upload from 192.0.2.1: %d", s)
	}
	if s := from("192.0.2.1"); s != http.StatusTooManyRequests {
		t.Errorf("second upload from 192.0.2.1: %d, want 429", s)
	}
	// The viewer chose the first entry; the proxy appended the real one.
	if s := from("203.0.113.10, 192.0.2.1"); s != http.StatusTooManyRequests {
		t.Errorf("forged first entry escaped the limit: %d, want 429", s)
	}
	if s := from("192.0.2.2"); s != http.StatusCreated {
		t.Errorf("first upload from 192.0.2.2: %d, want 201", s)
	}
}

func TestDeleteBySessionRemovesOnlyThatSessionAndAnnouncesIt(t *testing.T) {
	e := newEnv(t, Config{InsecureAdmin: true})
	a1 := e.mustUpload(sessionA)
	b := e.mustUpload(sessionB)
	a2 := e.mustUpload(sessionA)
	ws := e.dial()

	r := e.do("DELETE", "/api/drawings", map[string]string{"X-Session-Id": sessionA}, "")
	if r.status != http.StatusOK || r.body["deleted"] != float64(2) {
		t.Fatalf("delete: %d %v, want deleted 2", r.status, r.body)
	}
	m := ws.read()
	if m["type"] != "removed" || !slices.Equal(sorted(strs(m["ids"])), sorted([]string{a1, a2})) {
		t.Errorf("message %v, want removed [%s %s]", m, a1, a2)
	}
	if ids := e.adminIDs(nil); !slices.Equal(ids, []string{b}) {
		t.Errorf("left %v, want [%s]", ids, b)
	}

	r = e.do("DELETE", "/api/drawings", map[string]string{"X-Session-Id": sessionA}, "")
	if r.status != http.StatusOK || r.body["deleted"] != float64(0) {
		t.Fatalf("second delete: %d %v, want deleted 0", r.status, r.body)
	}
	ws.send(`{"type":"list"}`)
	if m := ws.read(); m["type"] != "list" {
		t.Errorf("message %v after deleting nothing, want only the list reply", m)
	}
}

func TestAdminRoutesRequireAValidToken(t *testing.T) {
	e := newEnv(t, Config{Verifier: fakeVerifier{}})
	e.mustUpload(sessionA)
	routes := []struct{ method, path, body string }{
		{"GET", "/api/admin/drawings", ""},
		{"DELETE", "/api/admin/drawings", `{"ids":[]}`},
		{"PUT", "/api/admin/settings", `{"aspect":"4:3"}`},
	}
	for _, rt := range routes {
		for name, header := range map[string]map[string]string{
			"no header":  nil,
			"bad token":  {"Authorization": "Bearer nope"},
			"no scheme":  {"Authorization": goodToken},
			"basic auth": {"Authorization": "Basic " + goodToken},
			"empty":      {"Authorization": "Bearer "},
		} {
			r := e.do(rt.method, rt.path, header, rt.body)
			if r.status != http.StatusUnauthorized || r.body["error"] == nil {
				t.Errorf("%s %s with %s: %d %v, want 401 with error", rt.method, rt.path, name, r.status, r.body)
			}
		}
		r := e.do(rt.method, rt.path, map[string]string{"Authorization": "Bearer " + goodToken}, rt.body)
		if r.status != http.StatusOK {
			t.Errorf("%s %s with good token: %d %v", rt.method, rt.path, r.status, r.body)
		}
	}
}

func TestAdminRoutesWithoutAuthConfigured(t *testing.T) {
	locked := newEnv(t, Config{})
	r := locked.do("GET", "/api/admin/drawings", map[string]string{"Authorization": "Bearer " + goodToken}, "")
	if r.status != http.StatusUnauthorized {
		t.Errorf("without a verifier: %d, want 401", r.status)
	}

	open := newEnv(t, Config{InsecureAdmin: true, Verifier: fakeVerifier{}})
	if r := open.do("GET", "/api/admin/drawings", nil, ""); r.status != http.StatusOK {
		t.Errorf("insecure admin: %d, want 200", r.status)
	}
	if r := open.do("PUT", "/api/admin/settings", nil, `{"aspect":"4:3"}`); r.status != http.StatusOK {
		t.Errorf("insecure admin settings: %d, want 200", r.status)
	}
}

func TestAdminListsEverythingNewestFirst(t *testing.T) {
	e := newEnv(t, Config{InsecureAdmin: true})
	if ids := e.adminIDs(nil); len(ids) != 0 {
		t.Fatalf("empty store lists %v", ids)
	}
	var want []string
	for _, s := range []string{sessionA, sessionB, sessionA} {
		want = append([]string{e.mustUpload(s)}, want...)
	}
	if ids := e.adminIDs(nil); !slices.Equal(ids, want) {
		t.Errorf("admin list %v, want %v", ids, want)
	}
}

func TestAdminDeleteRemovesAndAnnounces(t *testing.T) {
	e := newEnv(t, Config{InsecureAdmin: true})
	a := e.mustUpload(sessionA)
	b := e.mustUpload(sessionB)
	ws := e.dial()

	r := e.do("DELETE", "/api/admin/drawings", nil, fmt.Sprintf(`{"ids":[%q,"unknown"]}`, a))
	if r.status != http.StatusOK || r.body["deleted"] != float64(1) {
		t.Fatalf("delete: %d %v, want deleted 1", r.status, r.body)
	}
	if m := ws.read(); m["type"] != "removed" || !slices.Equal(strs(m["ids"]), []string{a}) {
		t.Errorf("message %v, want removed [%s]", m, a)
	}
	if ids := e.adminIDs(nil); !slices.Equal(ids, []string{b}) {
		t.Errorf("left %v, want [%s]", ids, b)
	}
	if r := e.do("DELETE", "/api/admin/drawings", nil, `{"ids":"x"}`); r.status != http.StatusBadRequest {
		t.Errorf("malformed ids: %d, want 400", r.status)
	}
}

func TestSettingsAreValidatedStoredAndReported(t *testing.T) {
	e := newEnv(t, Config{InsecureAdmin: true})
	if r := e.do("GET", "/api/config", nil, ""); fmt.Sprint(r.body["settings"]) != "map[aspect:5:4]" {
		t.Errorf("default settings %v, want aspect 5:4", r.body["settings"])
	}
	for _, aspect := range []string{"16:9", "1:4", "4:1", "1:1", "1000:250"} {
		r := e.do("PUT", "/api/admin/settings", nil, fmt.Sprintf(`{"aspect":%q}`, aspect))
		if r.status != http.StatusOK || r.body["aspect"] != aspect || len(r.body) != 1 {
			t.Errorf("PUT %s: %d %v", aspect, r.status, r.body)
		}
		if r := e.do("GET", "/api/config", nil, ""); r.body["settings"].(map[string]any)["aspect"] != aspect {
			t.Errorf("config after PUT %s: %v", aspect, r.body["settings"])
		}
	}
	for _, body := range []string{
		`{"aspect":"0:1"}`, `{"aspect":"1:0"}`, `{"aspect":"-4:3"}`, `{"aspect":"4.5:3"}`,
		`{"aspect":"1:5"}`, `{"aspect":"5:1"}`, `{"aspect":"04:3"}`, `{"aspect":"4:3:2"}`,
		`{"aspect":"4/3"}`, `{"aspect":" 4:3"}`, `{"aspect":""}`, `{}`, `{"aspect":"4:3","x":1}`,
		`{"aspect":"` + strings.Repeat("9", 400) + `:1"}`,
	} {
		if r := e.do("PUT", "/api/admin/settings", nil, body); r.status != http.StatusBadRequest || r.body["error"] == nil {
			t.Errorf("PUT %s: %d %v, want 400", body, r.status, r.body)
		}
	}
	if r := e.do("GET", "/api/config", nil, ""); r.body["settings"].(map[string]any)["aspect"] != "1000:250" {
		t.Errorf("rejected PUTs changed the settings: %v", r.body["settings"])
	}
}

func TestConfigReportsAuthAndIsNotCached(t *testing.T) {
	without := newEnv(t, Config{})
	r := without.do("GET", "/api/config", nil, "")
	if v, ok := r.body["auth"]; !ok || v != nil {
		t.Errorf("auth %v (present %v), want null", v, ok)
	}
	if cc := r.header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control %q, want no-store", cc)
	}

	cognito := &auth.Cognito{Region: "ap-northeast-1", UserPoolID: "pool", ClientID: "client"}
	with := newEnv(t, Config{Cognito: cognito, Verifier: fakeVerifier{}})
	r = with.do("GET", "/api/config", nil, "")
	if fmt.Sprint(r.body["auth"]) != "map[clientId:client region:ap-northeast-1 userPoolId:pool]" {
		t.Errorf("auth %v", r.body["auth"])
	}
}

func TestUnknownAPIRoutesAndMethodsAnswerInJSON(t *testing.T) {
	e := newEnv(t, Config{})
	if r := e.do("GET", "/api/nope", nil, ""); r.status != http.StatusNotFound || r.body["error"] == nil {
		t.Errorf("unknown route: %d %v", r.status, r.body)
	}
	r := e.do("PUT", "/api/drawings", nil, "")
	if r.status != http.StatusMethodNotAllowed || r.body["error"] == nil {
		t.Errorf("wrong method: %d %v", r.status, r.body)
	}
	if allow := r.header.Get("Allow"); allow != "DELETE, POST" {
		t.Errorf("Allow %q", allow)
	}
}

func TestWebSocketListAndGet(t *testing.T) {
	e := newEnv(t, Config{})
	a := e.mustUpload(sessionA)
	b := e.mustUpload(sessionB)
	ws := e.dial()

	ws.send(`{"type":"list"}`)
	m := ws.read()
	var listed []string
	for _, d := range m["drawings"].([]any) {
		sum := d.(map[string]any)
		if len(sum) != 2 || sum["createdAt"] == nil {
			t.Errorf("list entry %v, want id and createdAt only", sum)
		}
		listed = append(listed, sum["id"].(string))
	}
	if m["type"] != "list" || !slices.Equal(listed, []string{b, a}) {
		t.Errorf("list %v, want [%s %s]", m, b, a)
	}

	ws.send(fmt.Sprintf(`{"type":"get","ids":[%q,"unknown",%q]}`, a, b))
	m = ws.read()
	var got []string
	for _, d := range m["drawings"].([]any) {
		dr := d.(map[string]any)
		if dr["frame"] == nil {
			t.Errorf("drawing %v has no frame", dr)
		}
		got = append(got, dr["id"].(string))
	}
	if m["type"] != "drawings" || !slices.Equal(got, []string{b, a}) {
		t.Errorf("get %v, want drawings [%s %s]", m, b, a)
	}

	ws.send(`{"type":"get","ids":[]}`)
	if m := ws.read(); m["type"] != "drawings" || len(m["drawings"].([]any)) != 0 {
		t.Errorf("get nothing: %v", m)
	}
}

func TestWebSocketRejectsBadMessagesAndKeepsTheConnection(t *testing.T) {
	e := newEnv(t, Config{})
	ws := e.dial()

	ids := make([]string, 101)
	for i := range ids {
		ids[i] = fmt.Sprintf("%q", fmt.Sprint(i))
	}
	hundred := `{"type":"get","ids":[` + strings.Join(ids[:100], ",") + `]}`
	ws.send(hundred)
	if m := ws.read(); m["type"] != "drawings" {
		t.Errorf("get with 100 ids: %v, want drawings", m)
	}

	for name, msg := range map[string]string{
		"101 ids":      `{"type":"get","ids":[` + strings.Join(ids, ",") + `]}`,
		"unknown type": `{"type":"delete","ids":["x"]}`,
		"no type":      `{}`,
		"not JSON":     `list`,
	} {
		ws.send(msg)
		m := ws.read()
		if m["type"] != "error" || m["message"] == "" || m["message"] == nil {
			t.Errorf("%s: %v, want error", name, m)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := ws.conn.Write(ctx, websocket.MessageBinary, []byte(`{"type":"list"}`)); err != nil {
		t.Fatal(err)
	}
	if m := ws.read(); m["type"] != "error" {
		t.Errorf("binary message: %v, want error", m)
	}

	ws.send(`{"type":"list"}`)
	if m := ws.read(); m["type"] != "list" {
		t.Errorf("after errors: %v, want list", m)
	}
}

func TestWebSocketClosesOnOversizedMessages(t *testing.T) {
	e := newEnv(t, Config{})
	ws := e.dial()
	ws.send(`{"type":"list","pad":"` + strings.Repeat("x", 64<<10) + `"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := ws.conn.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusMessageTooBig {
		t.Errorf("read after oversized message: %v, want close 1009", err)
	}
}

func TestWebSocketAcceptsAnyOrigin(t *testing.T) {
	e := newEnv(t, Config{})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.ts.URL, "http")+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": {"http://localhost:5173"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	conn.CloseNow()
}

func TestEveryClientReceivesBroadcasts(t *testing.T) {
	e := newEnv(t, Config{})
	sockets := []*socket{e.dial(), e.dial(), e.dial()}
	id := e.mustUpload(sessionA)
	for i, ws := range sockets {
		m := ws.read()
		if m["type"] != "added" || m["drawing"].(map[string]any)["id"] != id {
			t.Errorf("client %d got %v", i, m)
		}
	}
}

func TestBroadcastSkipsClientsWithAFullQueue(t *testing.T) {
	h := newHub()
	slow := &client{send: make(chan []byte, wsSendBuffer)}
	fast := &client{send: make(chan []byte, wsSendBuffer)}
	h.add(slow)
	h.add(fast)
	for range wsSendBuffer {
		h.broadcast(removedMessage{Type: "removed", IDs: []string{"old"}})
	}
	<-fast.send
	done := make(chan struct{})
	go func() {
		h.broadcast(removedMessage{Type: "removed", IDs: []string{"new"}})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("broadcast blocked on a full queue")
	}
	if len(slow.send) != wsSendBuffer {
		t.Errorf("slow queue holds %d, want %d", len(slow.send), wsSendBuffer)
	}
	var last []byte
	for len(fast.send) > 0 {
		last = <-fast.send
	}
	if !strings.Contains(string(last), "new") {
		t.Errorf("fast client's last message %s, want the new one", last)
	}
	h.remove(slow)
	h.remove(fast)
}

func TestCloseDisconnectsClients(t *testing.T) {
	e := newEnv(t, Config{})
	ws := e.dial()
	read := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _, err := ws.conn.Read(ctx)
		read <- err
	}()
	start := time.Now()
	e.srv.Close()
	if d := time.Since(start); d > 2*time.Second {
		t.Errorf("Close took %v with a responsive client", d)
	}
	if err := <-read; websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Errorf("read after Close: %v, want close 1001", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	late, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer late.CloseNow()
	if _, _, err := late.Read(ctx); websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Errorf("connection after Close: %v, want close 1001", err)
	}
}
