from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
from flask_cors import CORS
import secrets
import functools
import hashlib

app = Flask(__name__)
CORS(app)

# SQLite database setup
DATABASE = '/netflix-tracker-db/watchtime.db'

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        # Create original watchtime table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS watchtime (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uniqueIdentifier TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                watchtime INTEGER NOT NULL,
                trackingEnabled BOOLEAN NOT NULL,
                dailyLimit INTEGER NOT NULL
            )
        ''')
        # Create new api_keys table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                api_key_hash TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL
            )
        ''')
        conn.commit()

# Initialize the database
init_db()

def require_api_key(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-Key')
        if not api_key:
            return jsonify({"error": "No API key provided"}), 401
        
        # Hash the provided API key
        api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        
        # Check if API key exists in database
        with sqlite3.connect(DATABASE) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM api_keys WHERE api_key_hash = ?', (api_key_hash,))
            if not cursor.fetchone():
                return jsonify({"error": "Invalid API key"}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.route('/generate-api-key', methods=['POST'])
def generate_api_key():
    # Generate a secure random API key
    api_key = secrets.token_urlsafe(32)
    api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    
    try:
        with sqlite3.connect(DATABASE) as conn:
            conn.execute(
                'INSERT INTO api_keys (api_key_hash, created_at) VALUES (?, ?)',
                (api_key_hash, datetime.now().isoformat())
            )
            conn.commit()
        return jsonify({"api_key": api_key})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Failed to generate API key"}), 500

@app.route('/update', methods=['POST'])
@require_api_key
def update_watchtime():
    data = request.json
    print(data)
    watchtime = data.get('watchtime')  # Watchtime in milliseconds
    uniqueIdentifier = data.get('uniqueIdentifier')  # Unique identifier
    trackingEnabled = data.get('trackingEnabled', True)  # Default to True if not provided
    dailyLimit = data.get('dailyLimit', 0)  # Default to 0 if not provided
    timestamp = datetime.now().isoformat()  # Current timestamp

    # Save to SQLite database
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            INSERT INTO watchtime (uniqueIdentifier, timestamp, watchtime, trackingEnabled, dailyLimit)
            VALUES (?, ?, ?, ?, ?)
        ''', (uniqueIdentifier, timestamp, watchtime, trackingEnabled, dailyLimit))
        conn.commit()

    # Log the received data
    print(f"Received data from {uniqueIdentifier}: {data}")
    return jsonify({"status": "success", "message": "Data received"})

@app.route('/get-watchtime', methods=['GET'])
@require_api_key
def get_watchtime():
    uniqueIdentifier = request.args.get('uniqueIdentifier')  # Get unique identifier from query params
    # Fetch watchtime data for the specified user
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT timestamp, watchtime FROM watchtime
            WHERE uniqueIdentifier = ?
            ORDER BY timestamp
        ''', (uniqueIdentifier,))
        rows = cursor.fetchall()

    # Format the data
    watchtime_data = [{"timestamp": row[0], "watchtime": row[1]} for row in rows]

    return jsonify({"status": "success", "data": watchtime_data})

if __name__ == '__main__':
    app.run(debug=True)