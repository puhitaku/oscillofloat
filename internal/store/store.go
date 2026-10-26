// Package store keeps drawings and settings in SQLite.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"github.com/puhitaku/oscillofloat/internal/shape"
)

// DefaultAspect is the aspect ratio reported until the operator sets one.
const DefaultAspect = "5:4"

// maxVariables splits long ID lists instead of binding them in one statement,
// which would run into SQLite's limit on bound parameters.
const maxVariables = 500

const schema = `
CREATE TABLE IF NOT EXISTS drawings (
	id         TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	frame      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drawings_session_id ON drawings (session_id);
CREATE INDEX IF NOT EXISTS drawings_created_at ON drawings (created_at);
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`

// Summary identifies a drawing without its frame.
type Summary struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
}

// Drawing is a stored frame with its identity.
type Drawing struct {
	ID        string      `json:"id"`
	CreatedAt string      `json:"createdAt"`
	Frame     shape.Frame `json:"frame"`
}

// Settings are the operator's display settings.
type Settings struct {
	Aspect string `json:"aspect"`
}

// Store is a SQLite database of drawings and settings.
type Store struct {
	db *sql.DB
}

// Open opens or creates the database at path and creates the schema.
func Open(path string) (*Store, error) {
	q := url.Values{}
	// Litestream replicates the write-ahead log, so the database must stay in
	// WAL mode rather than the default rollback journal.
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(NORMAL)")
	q.Add("_pragma", "busy_timeout(5000)")
	db, err := sql.Open("sqlite", path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return &Store{db: db}, nil
}

// Close closes the database.
func (s *Store) Close() error {
	return s.db.Close()
}

// Add stores a frame uploaded by a session.
func (s *Store) Add(ctx context.Context, sessionID string, frame shape.Frame) (Drawing, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return Drawing{}, err
	}
	data, err := json.Marshal(frame)
	if err != nil {
		return Drawing{}, err
	}
	d := Drawing{
		ID:        id.String(),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Frame:     frame,
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO drawings (id, session_id, created_at, frame) VALUES (?, ?, ?, ?)`,
		d.ID, sessionID, d.CreatedAt, string(data))
	if err != nil {
		return Drawing{}, err
	}
	return d, nil
}

// List returns every drawing without its frame, newest first.
func (s *Store) List(ctx context.Context) ([]Summary, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, created_at FROM drawings ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Summary{}
	for rows.Next() {
		var sum Summary
		if err := rows.Scan(&sum.ID, &sum.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, sum)
	}
	return list, rows.Err()
}

// All returns every drawing, newest first.
func (s *Store) All(ctx context.Context) ([]Drawing, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, created_at, frame FROM drawings ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDrawings(rows)
}

// Get returns the drawings with the given IDs, newest first. Unknown IDs are
// left out.
func (s *Store) Get(ctx context.Context, ids []string) ([]Drawing, error) {
	all := []Drawing{}
	for _, chunk := range chunks(unique(ids)) {
		rows, err := s.db.QueryContext(ctx,
			`SELECT id, created_at, frame FROM drawings WHERE id IN (`+placeholders(len(chunk))+`)`,
			args(chunk)...)
		if err != nil {
			return nil, err
		}
		ds, err := scanDrawings(rows)
		rows.Close()
		if err != nil {
			return nil, err
		}
		all = append(all, ds...)
	}
	sortNewestFirst(all)
	return all, nil
}

// DeleteBySession deletes every drawing uploaded by the session and returns
// their IDs.
func (s *Store) DeleteBySession(ctx context.Context, sessionID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`DELETE FROM drawings WHERE session_id = ? RETURNING id`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanIDs(rows)
}

// Delete deletes the drawings with the given IDs and returns the IDs that
// existed.
func (s *Store) Delete(ctx context.Context, ids []string) ([]string, error) {
	deleted := []string{}
	for _, chunk := range chunks(unique(ids)) {
		rows, err := s.db.QueryContext(ctx,
			`DELETE FROM drawings WHERE id IN (`+placeholders(len(chunk))+`) RETURNING id`,
			args(chunk)...)
		if err != nil {
			return nil, err
		}
		got, err := scanIDs(rows)
		rows.Close()
		if err != nil {
			return nil, err
		}
		deleted = append(deleted, got...)
	}
	return deleted, nil
}

// GetSettings returns the stored settings, with defaults for unset keys.
func (s *Store) GetSettings(ctx context.Context) (Settings, error) {
	st := Settings{Aspect: DefaultAspect}
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = 'aspect'`).Scan(&v)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return Settings{}, err
	default:
		st.Aspect = v
	}
	return st, nil
}

// SetSettings stores the settings.
func (s *Store) SetSettings(ctx context.Context, st Settings) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings (key, value) VALUES ('aspect', ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, st.Aspect)
	return err
}

func scanDrawings(rows *sql.Rows) ([]Drawing, error) {
	ds := []Drawing{}
	for rows.Next() {
		var d Drawing
		var frame string
		if err := rows.Scan(&d.ID, &d.CreatedAt, &frame); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(frame), &d.Frame); err != nil {
			return nil, fmt.Errorf("drawing %s: %w", d.ID, err)
		}
		ds = append(ds, d)
	}
	return ds, rows.Err()
}

func scanIDs(rows *sql.Rows) ([]string, error) {
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func unique(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func chunks(ids []string) [][]string {
	var out [][]string
	for len(ids) > 0 {
		n := min(len(ids), maxVariables)
		out = append(out, ids[:n])
		ids = ids[n:]
	}
	return out
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func args(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

func sortNewestFirst(ds []Drawing) {
	slices.SortFunc(ds, func(a, b Drawing) int {
		if c := strings.Compare(b.CreatedAt, a.CreatedAt); c != 0 {
			return c
		}
		return strings.Compare(b.ID, a.ID)
	})
}
