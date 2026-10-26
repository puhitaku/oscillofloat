package shape

import (
	"math"
	"testing"
)

func line(points ...[2]float64) Path {
	p := Path{}
	for _, v := range points {
		p.Points = append(p.Points, Point{X: v[0], Y: v[1]})
	}
	return p
}

func TestValidateAcceptsPolylinesAndDots(t *testing.T) {
	f := Frame{Paths: []Path{line([2]float64{-1, -1}, [2]float64{1, 1}), line([2]float64{0, 0})}}
	if err := f.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRejectsEmptyFrameAndEmptyPath(t *testing.T) {
	if err := (&Frame{}).Validate(); err == nil {
		t.Error("empty frame accepted")
	}
	if err := (&Frame{Paths: []Path{{}}}).Validate(); err == nil {
		t.Error("empty path accepted")
	}
}

func TestValidateRejectsOutOfRangeAndNaN(t *testing.T) {
	for _, bad := range []Frame{
		{Paths: []Path{line([2]float64{1.01, 0})}},
		{Paths: []Path{line([2]float64{0, math.NaN()})}},
		{Paths: []Path{line([2]float64{0, math.Inf(1)})}},
		{Paths: []Path{{Points: []Point{{X: 0, Y: 0, In: &Vec{3, 0}}}}}},
	} {
		if err := bad.Validate(); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
	ok := Frame{Paths: []Path{{Points: []Point{{X: 1, Y: -1, Out: &Vec{-2, 2}}}}}}
	if err := ok.Validate(); err != nil {
		t.Errorf("handle at the bound rejected: %v", err)
	}
}

func TestValidateEnforcesCounts(t *testing.T) {
	many := Frame{}
	for i := 0; i <= MaxPathsPerFrame; i++ {
		many.Paths = append(many.Paths, line([2]float64{0, 0}))
	}
	if err := many.Validate(); err == nil {
		t.Error("too many paths accepted")
	}
	long := Path{}
	for i := 0; i <= MaxPointsPerFrame; i++ {
		long.Points = append(long.Points, Point{})
	}
	if err := (&Frame{Paths: []Path{long}}).Validate(); err == nil {
		t.Error("too many points accepted")
	}
}
