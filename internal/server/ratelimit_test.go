package server

import (
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }
func limiterAt(c *clock, n int) *rateLimiter {
	l := newRateLimiter(n)
	l.now = c.now
	return l
}

func TestRateLimiterAllowsBurstThenRefillsContinuously(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := limiterAt(c, 6)
	for i := range 6 {
		if !l.allow("a") {
			t.Fatalf("upload %d refused within the burst", i+1)
		}
	}
	if l.allow("a") {
		t.Fatal("7th upload allowed")
	}
	c.advance(9 * time.Second)
	if l.allow("a") {
		t.Fatal("allowed before a token refilled")
	}
	c.advance(time.Second)
	if !l.allow("a") {
		t.Fatal("refused after 10 s refilled one token")
	}
	if l.allow("a") {
		t.Fatal("allowed a second token after 10 s")
	}
}

func TestRateLimiterKeepsAddressesApart(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := limiterAt(c, 1)
	if !l.allow("a") || l.allow("a") {
		t.Fatal("a should get exactly one upload")
	}
	if !l.allow("b") {
		t.Fatal("b refused because of a")
	}
}

func TestRateLimiterCapsRefillAtCapacity(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := limiterAt(c, 2)
	l.allow("b")
	c.advance(time.Second)
	l.allow("a")
	c.advance(59 * time.Second)
	l.allow("b")
	c.advance(59 * time.Second)
	if _, ok := l.buckets["a"]; !ok {
		t.Fatal("a was pruned; the test needs it idle but kept")
	}
	for range 2 {
		if !l.allow("a") {
			t.Fatal("refused within capacity")
		}
	}
	if l.allow("a") {
		t.Fatal("118 s of idle time accumulated beyond capacity")
	}
}

func TestRateLimiterPrunesIdleBuckets(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := limiterAt(c, 10)
	l.allow("idle")
	c.advance(30 * time.Second)
	l.allow("active")
	c.advance(40 * time.Second)
	l.allow("active")
	if _, ok := l.buckets["idle"]; ok {
		t.Error("bucket idle for 70 s kept")
	}
	if _, ok := l.buckets["active"]; !ok {
		t.Error("active bucket pruned")
	}
}

func TestRateLimiterPruningKeepsPartlyRefilledBuckets(t *testing.T) {
	c := &clock{t: time.Unix(1_000_000, 0)}
	l := limiterAt(c, 2)
	l.allow("a")
	l.allow("a")
	c.advance(30 * time.Second)
	if !l.allow("a") {
		t.Fatal("a did not refill one token in 30 s")
	}
	c.advance(30 * time.Second)
	l.allow("b")
	if !l.allow("a") {
		t.Fatal("a did not refill one token in the next 30 s")
	}
	if l.allow("a") {
		t.Fatal("pruning reset a's bucket")
	}
}
