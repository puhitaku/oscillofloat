package server

import (
	"sync"
	"time"
)

type rateLimiter struct {
	capacity float64
	perSec   float64
	now      func() time.Time

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastPrune time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(perMinute int) *rateLimiter {
	return &rateLimiter{
		capacity: float64(perMinute),
		perSec:   float64(perMinute) / 60,
		now:      time.Now,
		buckets:  map[string]*bucket{},
	}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.prune(now)
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.capacity, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.capacity, b.tokens+now.Sub(b.last).Seconds()*l.perSec)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// prune drops buckets that have refilled completely rather than keeping every
// address ever seen: a full bucket behaves exactly like a missing one.
func (l *rateLimiter) prune(now time.Time) {
	if now.Sub(l.lastPrune) < time.Minute {
		return
	}
	l.lastPrune = now
	for key, b := range l.buckets {
		if now.Sub(b.last) >= time.Minute {
			delete(l.buckets, key)
		}
	}
}
