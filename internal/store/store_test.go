package store

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/puhitaku/oscillofloat/internal/shape"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func dot(x, y float64) shape.Frame {
	return shape.Frame{Paths: []shape.Path{{Points: []shape.Point{{X: x, Y: y}}}}}
}

func add(t *testing.T, s *Store, session string, frame shape.Frame) Drawing {
	t.Helper()
	d, err := s.Add(context.Background(), session, frame)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func ids(ds []Drawing) []string {
	out := []string{}
	for _, d := range ds {
		out = append(out, d.ID)
	}
	return out
}

func TestOpenUsesWAL(t *testing.T) {
	s := open(t)
	var mode string
	if err := s.db.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}
}

func TestAddedDrawingComesBackIntact(t *testing.T) {
	s := open(t)
	frame := shape.Frame{Paths: []shape.Path{{
		Closed: true,
		Points: []shape.Point{{X: 0.1, Y: 0.2}, {X: -0.3, Y: 0.25, In: &shape.Vec{0.2, 1.5}, Out: &shape.Vec{-2, 0}}},
	}}}
	d := add(t, s, "session-aaaaaaaaaa", frame)
	if _, err := time.Parse(time.RFC3339, d.CreatedAt); err != nil {
		t.Errorf("createdAt %q is not RFC 3339: %v", d.CreatedAt, err)
	}
	if d.CreatedAt[len(d.CreatedAt)-1] != 'Z' {
		t.Errorf("createdAt %q is not UTC", d.CreatedAt)
	}
	got, err := s.Get(context.Background(), []string{d.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !reflect.DeepEqual(got[0], d) {
		t.Errorf("Get = %+v, want [%+v]", got, d)
	}
}

func TestListingsAreNewestFirst(t *testing.T) {
	s := open(t)
	var added []string
	for i := range 5 {
		added = append(added, add(t, s, "session-aaaaaaaaaa", dot(float64(i)/10, 0)).ID)
	}
	newest := slices.Clone(added)
	slices.Reverse(newest)

	all, err := s.All(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(ids(all), newest) {
		t.Errorf("All = %v, want %v", ids(all), newest)
	}

	list, err := s.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var listed []string
	for _, sum := range list {
		listed = append(listed, sum.ID)
	}
	if !slices.Equal(listed, newest) {
		t.Errorf("List = %v, want %v", listed, newest)
	}

	got, err := s.Get(context.Background(), []string{added[0], "unknown", added[3], added[0]})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{added[3], added[0]}; !slices.Equal(ids(got), want) {
		t.Errorf("Get = %v, want %v", ids(got), want)
	}
}

func TestEmptyStoreListsNothing(t *testing.T) {
	s := open(t)
	all, err := s.All(context.Background())
	if err != nil || all == nil || len(all) != 0 {
		t.Errorf("All = %v, %v; want empty non-nil", all, err)
	}
	list, err := s.List(context.Background())
	if err != nil || list == nil || len(list) != 0 {
		t.Errorf("List = %v, %v; want empty non-nil", list, err)
	}
}

func TestGetAndDeleteHandleMoreIDsThanOneStatementBinds(t *testing.T) {
	s := open(t)
	d := add(t, s, "session-aaaaaaaaaa", dot(0, 0))
	var many []string
	for i := range 2 * maxVariables {
		many = append(many, fmt.Sprintf("unknown-%d", i))
	}
	many = append(many, d.ID)
	got, err := s.Get(context.Background(), many)
	if err != nil || !slices.Equal(ids(got), []string{d.ID}) {
		t.Errorf("Get = %v, %v", ids(got), err)
	}
	deleted, err := s.Delete(context.Background(), many)
	if err != nil || !slices.Equal(deleted, []string{d.ID}) {
		t.Errorf("Delete = %v, %v", deleted, err)
	}
}

func TestDeleteBySessionRemovesOnlyThatSession(t *testing.T) {
	s := open(t)
	a1 := add(t, s, "session-aaaaaaaaaa", dot(0, 0))
	b := add(t, s, "session-bbbbbbbbbb", dot(0, 0))
	a2 := add(t, s, "session-aaaaaaaaaa", dot(0, 0))

	deleted, err := s.DeleteBySession(context.Background(), "session-aaaaaaaaaa")
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(deleted)
	want := []string{a1.ID, a2.ID}
	slices.Sort(want)
	if !slices.Equal(deleted, want) {
		t.Errorf("DeleteBySession = %v, want %v", deleted, want)
	}

	all, err := s.All(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(ids(all), []string{b.ID}) {
		t.Errorf("left %v, want [%s]", ids(all), b.ID)
	}

	deleted, err = s.DeleteBySession(context.Background(), "session-aaaaaaaaaa")
	if err != nil || len(deleted) != 0 {
		t.Errorf("second DeleteBySession = %v, %v; want nothing", deleted, err)
	}
}

func TestDeleteReturnsOnlyExistingIDs(t *testing.T) {
	s := open(t)
	a := add(t, s, "session-aaaaaaaaaa", dot(0, 0))
	b := add(t, s, "session-aaaaaaaaaa", dot(0, 0))

	deleted, err := s.Delete(context.Background(), []string{a.ID, "unknown", a.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(deleted, []string{a.ID}) {
		t.Errorf("Delete = %v, want [%s]", deleted, a.ID)
	}
	all, err := s.All(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(ids(all), []string{b.ID}) {
		t.Errorf("left %v, want [%s]", ids(all), b.ID)
	}
}

func TestSettingsDefaultAndRoundTrip(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	st, err := s.GetSettings(ctx)
	if err != nil || st.Aspect != "5:4" {
		t.Errorf("default settings = %+v, %v; want aspect 5:4", st, err)
	}
	for _, aspect := range []string{"16:9", "4:3"} {
		if err := s.SetSettings(ctx, Settings{Aspect: aspect}); err != nil {
			t.Fatal(err)
		}
		st, err = s.GetSettings(ctx)
		if err != nil || st.Aspect != aspect {
			t.Errorf("settings = %+v, %v; want aspect %s", st, err, aspect)
		}
	}
}

func TestDataSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.Add(context.Background(), "session-aaaaaaaaaa", dot(0.5, 0.5))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetSettings(context.Background(), Settings{Aspect: "1:1"}); err != nil {
		t.Fatal(err)
	}
	s.Close()

	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	all, err := s.All(context.Background())
	if err != nil || len(all) != 1 || !reflect.DeepEqual(all[0], d) {
		t.Errorf("after reopen All = %+v, %v", all, err)
	}
	st, err := s.GetSettings(context.Background())
	if err != nil || st.Aspect != "1:1" {
		t.Errorf("after reopen settings = %+v, %v", st, err)
	}
}
