package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/puhitaku/oscillofloat/internal/store"
)

const (
	wsReadLimit    = 64 << 10
	wsSendBuffer   = 64
	wsWriteTimeout = 10 * time.Second
	wsPingInterval = 20 * time.Second
	wsPingTimeout  = 10 * time.Second
	maxGetIDs      = 100
)

type addedMessage struct {
	Type    string        `json:"type"`
	Drawing store.Drawing `json:"drawing"`
}

type removedMessage struct {
	Type string   `json:"type"`
	IDs  []string `json:"ids"`
}

type listMessage struct {
	Type     string          `json:"type"`
	Drawings []store.Summary `json:"drawings"`
}

type drawingsMessage struct {
	Type     string          `json:"type"`
	Drawings []store.Drawing `json:"drawings"`
}

type errorMessage struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type clientMessage struct {
	Type string   `json:"type"`
	IDs  []string `json:"ids"`
}

type client struct {
	conn *websocket.Conn
	send chan []byte
}

type hub struct {
	mu      sync.Mutex
	clients map[*client]struct{}
	closed  bool
	running sync.WaitGroup
}

func newHub() *hub {
	return &hub{clients: map[*client]struct{}{}}
}

func (h *hub) add(c *client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return false
	}
	h.clients[c] = struct{}{}
	h.running.Add(1)
	return true
}

func (h *hub) remove(c *client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	h.running.Done()
}

// broadcast skips a client whose queue is full instead of waiting for it,
// which would stall the uploader and every other client.
func (h *hub) broadcast(msg any) {
	data, err := json.Marshal(msg)
	if err != nil {
		panic(err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.send <- data:
		default:
		}
	}
}

func (h *hub) close() {
	h.mu.Lock()
	h.closed = true
	clients := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()
	var wg sync.WaitGroup
	for _, c := range clients {
		wg.Go(func() { c.conn.Close(websocket.StatusGoingAway, "server shutting down") })
	}
	wg.Wait()
	h.running.Wait()
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	// OriginPatterns is not used: oscilloshape connects from a page served on
	// localhost, and the socket is read-only, so any origin is accepted.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	conn.SetReadLimit(wsReadLimit)

	c := &client{conn: conn, send: make(chan []byte, wsSendBuffer)}
	if !s.hub.add(c) {
		conn.Close(websocket.StatusGoingAway, "server shutting down")
		return
	}
	defer s.hub.remove(c)

	ctx, cancel := context.WithCancel(r.Context())
	var writer sync.WaitGroup
	writer.Go(func() {
		defer cancel()
		s.writeLoop(ctx, c)
	})
	s.readLoop(ctx, c)
	cancel()
	writer.Wait()
	conn.CloseNow()
}

func (s *Server) writeLoop(ctx context.Context, c *client) {
	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
			err := c.conn.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, wsPingTimeout)
			err := c.conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func (s *Server) readLoop(ctx context.Context, c *client) {
	for {
		typ, data, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		var reply any
		if typ != websocket.MessageText {
			reply = errorMessage{Type: "error", Message: "messages must be text"}
		} else {
			reply = s.answer(ctx, data)
		}
		msg, err := json.Marshal(reply)
		if err != nil {
			panic(err)
		}
		select {
		case c.send <- msg:
		case <-ctx.Done():
			return
		}
	}
}

func (s *Server) answer(ctx context.Context, data []byte) any {
	var req clientMessage
	if err := json.Unmarshal(data, &req); err != nil {
		return errorMessage{Type: "error", Message: "invalid JSON"}
	}
	switch req.Type {
	case "list":
		list, err := s.store.List(ctx)
		if err != nil {
			s.log.Error("list drawings", "err", err)
			return errorMessage{Type: "error", Message: "internal error"}
		}
		return listMessage{Type: "list", Drawings: list}
	case "get":
		if len(req.IDs) > maxGetIDs {
			return errorMessage{Type: "error", Message: fmt.Sprintf("too many ids: %d > %d", len(req.IDs), maxGetIDs)}
		}
		ds, err := s.store.Get(ctx, req.IDs)
		if err != nil {
			s.log.Error("get drawings", "err", err)
			return errorMessage{Type: "error", Message: "internal error"}
		}
		return drawingsMessage{Type: "drawings", Drawings: ds}
	default:
		return errorMessage{Type: "error", Message: fmt.Sprintf("unknown type %q", req.Type)}
	}
}
