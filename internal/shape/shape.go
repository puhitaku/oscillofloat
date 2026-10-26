// Package shape defines the drawing format shared with the frontend and with
// oscilloshape, and the limits a stored drawing must respect.
//
// Both axes span [-1, 1], +X is right and +Y is up. A drawing is always the
// 1:1 square; the aspect ratio of the oscilloscope screen is a display
// concern handled by the clients.
package shape

import (
	"errors"
	"fmt"
	"math"
)

// Limits on what a single frame may contain. They sit well below what
// oscilloshape accepts per frame so a drawing is never rejected downstream.
const (
	MaxPathsPerFrame  = 512
	MaxPointsPerFrame = 8000
	// MaxHandle bounds Bezier handles, which may legitimately leave the
	// square while their anchors stay inside it.
	MaxHandle = 2
)

// Vec is an [x, y] pair.
type Vec [2]float64

// Point is an anchor point in the Illustrator sense. In and Out are optional
// absolute positions of the Bezier handles belonging to the segments that
// arrive at and leave from the anchor. A segment between two anchors is a
// straight line when neither facing handle is set, and a cubic Bezier curve
// otherwise.
type Point struct {
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	In  *Vec    `json:"in,omitempty"`
	Out *Vec    `json:"out,omitempty"`
}

// Path is an open or closed chain of anchors. A path with a single point is
// a dot.
type Path struct {
	Closed bool    `json:"closed"`
	Points []Point `json:"points"`
}

// Frame is everything the beam draws during one trace.
type Frame struct {
	Paths []Path `json:"paths"`
}

// Validate reports whether the frame is within limits, finite and inside the
// square.
func (f *Frame) Validate() error {
	if len(f.Paths) == 0 {
		return errors.New("no paths")
	}
	if len(f.Paths) > MaxPathsPerFrame {
		return fmt.Errorf("too many paths: %d > %d", len(f.Paths), MaxPathsPerFrame)
	}
	n := 0
	for i, p := range f.Paths {
		if len(p.Points) == 0 {
			return fmt.Errorf("path %d has no points", i)
		}
		n += len(p.Points)
		if n > MaxPointsPerFrame {
			return fmt.Errorf("too many points: more than %d", MaxPointsPerFrame)
		}
		for _, pt := range p.Points {
			if !within(1, pt.X, pt.Y) {
				return fmt.Errorf("path %d: anchor outside [-1, 1]", i)
			}
			if pt.In != nil && !within(MaxHandle, pt.In[0], pt.In[1]) {
				return fmt.Errorf("path %d: handle outside [-%d, %d]", i, MaxHandle, MaxHandle)
			}
			if pt.Out != nil && !within(MaxHandle, pt.Out[0], pt.Out[1]) {
				return fmt.Errorf("path %d: handle outside [-%d, %d]", i, MaxHandle, MaxHandle)
			}
		}
	}
	return nil
}

func within(limit float64, vs ...float64) bool {
	for _, v := range vs {
		if math.IsNaN(v) || v < -limit || v > limit {
			return false
		}
	}
	return true
}
