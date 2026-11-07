"""Autenticacao local em SQLite. Nenhuma senha nem sessao em claro no banco."""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import sys
import time
from contextlib import contextmanager, closing
from pathlib import Path

DATA_DIR = Path(os.environ.get('PANEL_DATA_DIR', '/app/data'))
COOKIE_NAME = 'znm_session'
SESSION_DAYS = 90
SESSION_TTL = SESSION_DAYS * 86400


def _paths():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / 'users.sqlite3', DATA_DIR / 'primeiro-acesso.txt'


def _connect():
    db_path, _ = _paths()
    con = sqlite3.connect(db_path, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA busy_timeout = 10000')
    con.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT COLLATE NOCASE NOT NULL UNIQUE, salt BLOB NOT NULL, password_hash BLOB NOT NULL, created_at INTEGER NOT NULL)')
    con.execute('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))')
    if os.name == 'posix':
        try: db_path.chmod(0o600)
        except OSError: pass
    return con


@contextmanager
def _db():
    with closing(_connect()) as con:
        with con:
            yield con


def has_user():
    with _db() as con:
        return con.execute('SELECT 1 FROM users LIMIT 1').fetchone() is not None


def setup_code():
    """Codigo de uso unico no log do Docker; nao aparece via HTTP."""
    _, path = _paths()
    if has_user():
        path.unlink(missing_ok=True)
        return None
    if not path.exists():
        # O_EXCL impede substituir codigo existente numa inicializacao concorrente.
        code = secrets.token_urlsafe(18)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='ascii') as f: f.write(code + '\n')
        except FileExistsError:
            pass
    return path.read_text(encoding='ascii').strip()


def announce_setup():
    code = setup_code()
    if code:
        print('\n' + '=' * 57, file=sys.stderr, flush=True)
        print(' ZimaOS Network Manager - PRIMEIRO ACESSO', file=sys.stderr, flush=True)
        print(' Abra o painel e crie seu usuario e senha.', file=sys.stderr, flush=True)
        print(' Codigo de instalacao (somente uma vez):', code, file=sys.stderr, flush=True)
        print(' Esse codigo aparece nos logs e nao e o token de login.', file=sys.stderr, flush=True)
        print('=' * 57 + '\n', file=sys.stderr, flush=True)


def _validate_user(username, password):
    if not re.fullmatch(r'[A-Za-z0-9_.-]{3,32}', username):
        raise ValueError('Usuário: 3 a 32 caracteres, letras, números, ponto, _ ou -.')
    if not 12 <= len(password) <= 128:
        raise ValueError('Senha: use de 12 a 128 caracteres.')
    if len(password.encode('utf-8')) > 512:
        raise ValueError('Senha muito longa.')


def _pw_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 350_000)


def create_admin(username, password, pairing_code):
    username = username.strip()
    _validate_user(username, password)
    _, path = _paths()
    code = setup_code()
    if not code or not hmac.compare_digest(code, pairing_code or ''):
        raise ValueError('Código de primeiro acesso inválido. Consulte os logs do contêiner.')
    with _db() as con:
        con.execute('BEGIN IMMEDIATE')
        if con.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            raise ValueError('O administrador já foi cadastrado.')
        salt = secrets.token_bytes(32)
        con.execute('INSERT INTO users (username,salt,password_hash,created_at) VALUES (?,?,?,?)',
                    (username, salt, _pw_hash(password, salt), int(time.time())))
    path.unlink(missing_ok=True)
    return login(username, password)


def _new_session(con, user_id):
    token = secrets.token_urlsafe(40)
    csrf = csrf_for_cookie(token)
    expires = int(time.time()) + SESSION_TTL
    con.execute('INSERT INTO sessions(hash,user_id,csrf_hash,expires_at) VALUES(?,?,?,?)',
                (hashlib.sha256(token.encode()).hexdigest(), user_id,
                 hashlib.sha256(csrf.encode()).hexdigest(), expires))
    return token, csrf


def login(username, password):
    # Dificulta diferenciar usuário inexistente por tempo de resposta.
    with _db() as con:
        row = con.execute('SELECT id,username,salt,password_hash FROM users WHERE username=?', (username.strip(),)).fetchone()
        salt = row['salt'] if row else bytes(32)
        correct = hmac.compare_digest(_pw_hash(password, salt), row['password_hash'] if row else bytes(32))
        if not row or not correct:
            return None
        con.execute('DELETE FROM sessions WHERE user_id=? AND expires_at < ?', (row['id'], int(time.time())))
        token, csrf = _new_session(con, row['id'])
        return {'token': token, 'csrf': csrf, 'username': row['username']}


def get_session(token):
    if not token: return None
    now = int(time.time())
    digest = hashlib.sha256(token.encode()).hexdigest()
    with _db() as con:
        row = con.execute('SELECT s.user_id,s.csrf_hash,s.expires_at,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=?', (digest,)).fetchone()
        if not row or row['expires_at'] <= now: return None
        # Sessao persistente, renovada durante uso sem salvar senha no navegador.
        if row['expires_at'] - now < SESSION_TTL - 86400:
            con.execute('UPDATE sessions SET expires_at=? WHERE hash=?', (now + SESSION_TTL, digest))
        return {'username': row['username'], 'csrf_hash': row['csrf_hash']}


def validate_csrf(session, value):
    return bool(session and value and hmac.compare_digest(
        session['csrf_hash'], hashlib.sha256(value.encode()).hexdigest()))


def csrf_for_cookie(token):
    """Nao armazenamos CSRF puro no banco; API exige token apresentado ao logar.

    Para reconexao apos atualizar pagina, CSRF derivado da sessao aleatoria
    por HMAC usando a propria sessao (que e segredo HttpOnly) funciona sem estado
    adicional no cliente. O valor devolvido so pode ser lido em mesma origem.
    """
    return hmac.new(token.encode(), b'znm-csrf-v1', hashlib.sha256).hexdigest()


def get_session_with_csrf(token):
    result = get_session(token)
    if result:
        # CSRF deterministico por sessao; evita perder autorizacao apos recarregar.
        result['csrf_hash'] = hashlib.sha256(csrf_for_cookie(token).encode()).hexdigest()
    return result


def logout(token):
    if token:
        with _db() as con:
            con.execute('DELETE FROM sessions WHERE hash=?', (hashlib.sha256(token.encode()).hexdigest(),))


def change_password(user, current, new):
    if not 12 <= len(new) <= 128: raise ValueError('Nova senha deve ter de 12 a 128 caracteres.')
    with _db() as con:
        row = con.execute('SELECT id,salt,password_hash FROM users WHERE username=?', (user,)).fetchone()
        if not row or not hmac.compare_digest(_pw_hash(current, row['salt']), row['password_hash']):
            raise ValueError('Senha atual incorreta.')
        salt = secrets.token_bytes(32)
        con.execute('UPDATE users SET salt=?,password_hash=? WHERE id=?', (salt, _pw_hash(new,salt), row['id']))
        con.execute('DELETE FROM sessions WHERE user_id=?', (row['id'],))
