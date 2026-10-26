package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testClientID = "test-client"
	testKeyID    = "test-key"
)

type issuer struct {
	*httptest.Server
	key           *rsa.PrivateKey
	failDiscovery atomic.Bool
}

func newIssuer(t *testing.T) *issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	iss := &issuer{key: key}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		if iss.failDiscovery.Load() {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                iss.URL,
			"jwks_uri":                              iss.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		b64 := base64.RawURLEncoding.EncodeToString
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA",
			"kid": testKeyID,
			"use": "sig",
			"alg": "RS256",
			"n":   b64(key.N.Bytes()),
			"e":   b64(big.NewInt(int64(key.E)).Bytes()),
		}}})
	})
	iss.Server = httptest.NewServer(mux)
	t.Cleanup(iss.Close)
	return iss
}

func (iss *issuer) claims() map[string]any {
	now := time.Now()
	return map[string]any{
		"iss":       iss.URL,
		"sub":       "operator",
		"aud":       testClientID,
		"token_use": "id",
		"iat":       now.Unix(),
		"auth_time": now.Unix(),
		"exp":       now.Add(time.Hour).Unix(),
	}
}

func sign(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	enc := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(b)
	}
	input := enc(map[string]string{"alg": "RS256", "typ": "JWT", "kid": testKeyID}) + "." + enc(claims)
	sum := sha256.Sum256([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestCognitoIssuer(t *testing.T) {
	c := Cognito{Region: "ap-northeast-1", UserPoolID: "ap-northeast-1_example"}
	if got, want := c.Issuer(), "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_example"; got != want {
		t.Errorf("Issuer = %q, want %q", got, want)
	}
}

func TestVerifyAcceptsValidIDToken(t *testing.T) {
	iss := newIssuer(t)
	v := newOIDCVerifier(iss.URL, testClientID)
	if err := v.Verify(context.Background(), sign(t, iss.key, iss.claims())); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyRejectsBadTokens(t *testing.T) {
	iss := newIssuer(t)
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	with := func(k string, v any) map[string]any {
		c := iss.claims()
		c[k] = v
		return c
	}
	without := func(k string) map[string]any {
		c := iss.claims()
		delete(c, k)
		return c
	}
	for name, token := range map[string]string{
		"wrong audience":   sign(t, iss.key, with("aud", "other-client")),
		"access token":     sign(t, iss.key, with("token_use", "access")),
		"no token_use":     sign(t, iss.key, without("token_use")),
		"expired":          sign(t, iss.key, with("exp", time.Now().Add(-time.Minute).Unix())),
		"wrong issuer":     sign(t, iss.key, with("iss", "https://example.invalid")),
		"wrong key":        sign(t, otherKey, iss.claims()),
		"not a JWT":        "garbage",
		"empty":            "",
		"tampered payload": swapPayload(sign(t, iss.key, iss.claims()), sign(t, otherKey, with("sub", "intruder"))),
	} {
		t.Run(name, func(t *testing.T) {
			v := newOIDCVerifier(iss.URL, testClientID)
			if err := v.Verify(context.Background(), token); err == nil {
				t.Error("accepted")
			}
		})
	}
}

func swapPayload(signed, other string) string {
	s := strings.Split(signed, ".")
	o := strings.Split(other, ".")
	return s[0] + "." + o[1] + "." + s[2]
}

func TestVerifyRetriesFailedDiscovery(t *testing.T) {
	iss := newIssuer(t)
	iss.failDiscovery.Store(true)
	v := newOIDCVerifier(iss.URL, testClientID)
	token := sign(t, iss.key, iss.claims())
	if err := v.Verify(context.Background(), token); err == nil {
		t.Fatal("accepted while discovery fails")
	}
	iss.failDiscovery.Store(false)
	if err := v.Verify(context.Background(), token); err != nil {
		t.Fatalf("after discovery recovered: %v", err)
	}
}
