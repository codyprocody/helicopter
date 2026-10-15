#!/usr/bin/env python3
"""Helicopter leaderboard API: stdlib only, SQLite storage, bound to 127.0.0.1."""
import json, os, re, sqlite3, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

DB_PATH = os.environ.get('HELI_DB', os.path.join(os.path.dirname(__file__), '..', 'data', 'scores.db'))
PORT = int(os.environ.get('HELI_PORT', '8110'))
NICK_RE = re.compile(r"^[\w .\-]{1,16}$", re.UNICODE)
MAX_RATE = 52          # max points per second the game can produce
MIN_INTERVAL = 2.0     # seconds between submissions per client
MAX_BODY = 512

lock = threading.Lock()
last_post = {}

def db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c

def init():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nick TEXT NOT NULL, score INTEGER NOT NULL, created_at INTEGER NOT NULL)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_scores_nick ON scores(nick COLLATE NOCASE, score)")

def top(c, limit):
    rows = c.execute("""SELECT nick, MAX(score) AS score FROM scores
                        GROUP BY nick COLLATE NOCASE ORDER BY score DESC, MIN(created_at) ASC LIMIT ?""", (limit,)).fetchall()
    return [{'nick': r['nick'], 'score': r['score']} for r in rows]

def rank_of(c, nick):
    best = c.execute("SELECT MAX(score) FROM scores WHERE nick = ? COLLATE NOCASE", (nick,)).fetchone()[0]
    better = c.execute("""SELECT COUNT(*) FROM (SELECT MAX(score) AS s FROM scores
                          GROUP BY nick COLLATE NOCASE) WHERE s > ?""", (best,)).fetchone()[0]
    return better + 1, best

class H(BaseHTTPRequestHandler):
    server_version = 'heli'
    sys_version = ''

    def log_message(self, *a): pass

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != '/api/leaderboard':
            return self.send_json(404, {'error': 'not found'})
        try:
            limit = max(1, min(50, int(parse_qs(u.query).get('limit', ['10'])[0])))
        except ValueError:
            limit = 10
        with db() as c:
            self.send_json(200, {'top': top(c, limit)})

    def do_POST(self):
        if urlparse(self.path).path != '/api/score':
            return self.send_json(404, {'error': 'not found'})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n <= 0 or n > MAX_BODY: raise ValueError
            data = json.loads(self.rfile.read(n))
            nick = str(data['nick']).strip()
            score = int(data['score']); ms = int(data['ms'])
        except Exception:
            return self.send_json(400, {'error': 'bad request'})
        if not NICK_RE.match(nick):
            return self.send_json(400, {'error': 'bad nickname'})
        if score < 0 or score > 1_000_000 or ms < 0 or score > (ms / 1000) * MAX_RATE + 5:
            return self.send_json(400, {'error': 'implausible score'})
        ip = self.headers.get('X-Real-IP') or self.client_address[0]
        now = time.time()
        with lock:
            if now - last_post.get(ip, 0) < MIN_INTERVAL:
                return self.send_json(429, {'error': 'slow down'})
            last_post[ip] = now
            if len(last_post) > 5000:
                for k in [k for k, t in last_post.items() if now - t > 60]: last_post.pop(k, None)
        with db() as c:
            if score > 0:
                c.execute("INSERT INTO scores (nick, score, created_at) VALUES (?,?,?)", (nick, score, int(now)))
            rank, best = rank_of(c, nick) if score > 0 or c.execute(
                "SELECT 1 FROM scores WHERE nick = ? COLLATE NOCASE", (nick,)).fetchone() else (None, None)
            self.send_json(200, {'top': top(c, 10), 'rank': rank, 'best': best})

if __name__ == '__main__':
    init()
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
