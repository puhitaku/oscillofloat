// Package auth verifies the operator's Cognito ID tokens.
package auth

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// Verifier checks a bearer token presented on the admin API.
type Verifier interface {
	Verify(ctx context.Context, token string) error
}

// Cognito names the user pool and app client whose ID tokens are accepted.
type Cognito struct {
	Region     string `json:"region"`
	UserPoolID string `json:"userPoolId"`
	ClientID   string `json:"clientId"`
}

// Issuer is the user pool's OIDC issuer URL.
func (c Cognito) Issuer() string {
	return fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s", c.Region, c.UserPoolID)
}

const discoveryTimeout = 10 * time.Second

// OIDCVerifier accepts ID tokens signed by an OIDC issuer for one client.
type OIDCVerifier struct {
	issuer   string
	clientID string

	mu       sync.Mutex
	verifier *oidc.IDTokenVerifier
}

// NewCognito returns a verifier for the user pool's ID tokens.
func NewCognito(c Cognito) *OIDCVerifier {
	return newOIDCVerifier(c.Issuer(), c.ClientID)
}

func newOIDCVerifier(issuer, clientID string) *OIDCVerifier {
	return &OIDCVerifier{issuer: issuer, clientID: clientID}
}

// Verify checks the signature, issuer, audience and expiry of an ID token,
// and that it is an ID token rather than an access token.
func (v *OIDCVerifier) Verify(ctx context.Context, token string) error {
	idv, err := v.idTokenVerifier(ctx)
	if err != nil {
		return err
	}
	id, err := idv.Verify(ctx, token)
	if err != nil {
		return err
	}
	var claims struct {
		TokenUse string `json:"token_use"`
	}
	if err := id.Claims(&claims); err != nil {
		return err
	}
	if claims.TokenUse != "id" {
		return errors.New("token_use is not id")
	}
	return nil
}

// idTokenVerifier runs OIDC discovery on first use instead of at startup: the
// instance may start the backend before its network is up, and an eager
// failure would leave the admin API broken until a restart. A failed
// discovery is retried on the next call.
func (v *OIDCVerifier) idTokenVerifier(ctx context.Context) (*oidc.IDTokenVerifier, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.verifier != nil {
		return v.verifier, nil
	}
	ctx, cancel := context.WithTimeout(ctx, discoveryTimeout)
	defer cancel()
	p, err := oidc.NewProvider(ctx, v.issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}
	v.verifier = p.Verifier(&oidc.Config{ClientID: v.clientID})
	return v.verifier, nil
}
