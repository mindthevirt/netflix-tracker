from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime, timedelta
from flask_cors import CORS
import secrets
import functools
import hashlib

app = Flask(__name__)
# Configure CORS with more specific settings
CORS(app, resources={
    r"/*": {
        "origins": ["chrome-extension://*", "https://binge-master.mindthevirt.com"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "X-API-Key"]
    }
})

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
        # Create users table for email storage
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uniqueIdentifier TEXT UNIQUE NOT NULL,
                email TEXT NOT NULL,
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

@app.route('/generate-api-key', methods=['POST', 'OPTIONS'])
def generate_api_key():
    if request.method == 'OPTIONS':
        return '', 204
    
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

@app.route('/update', methods=['POST', 'OPTIONS'])
@require_api_key
def update_watchtime():
    if request.method == 'OPTIONS':
        return '', 204
        
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

@app.route('/get-watchtime', methods=['GET', 'OPTIONS'])
@require_api_key
def get_watchtime():
    if request.method == 'OPTIONS':
        return '', 204
        
    uniqueIdentifier = request.args.get('uniqueIdentifier')  # Get unique identifier from query params
    
    # Get date 7 days ago in ISO format for comparison
    today = datetime.now().date()
    seven_days_ago = (today - timedelta(days=7)).isoformat()
    
    # Fetch watchtime data for the specified user for the last 7 days
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT timestamp, watchtime 
            FROM watchtime
            WHERE uniqueIdentifier = ?
              AND date(timestamp) >= ?
            ORDER BY timestamp
        ''', (uniqueIdentifier, seven_days_ago))
        rows = cursor.fetchall()

    # Calculate total watchtime and include individual entries
    total_watchtime = sum(row[1] for row in rows)  # Sum all watchtime entries
    watchtime_data = [{"timestamp": row[0], "watchtime": row[1]} for row in rows]

    return jsonify({
        "status": "success", 
        "data": watchtime_data,
        "total_watchtime": total_watchtime  # Add total watchtime in milliseconds
    })

@app.route('/register', methods=['POST'])
@require_api_key
def register_user():
    data = request.get_json()
    email = data.get('email')
    unique_identifier = data.get('uniqueIdentifier')
    
    if not email or not unique_identifier:
        return jsonify({'error': 'Email and uniqueIdentifier are required'}), 400
    
    try:
        with sqlite3.connect(DATABASE) as conn:
            # Check if user already exists
            existing_user = conn.execute(
                'SELECT id FROM users WHERE uniqueIdentifier = ?', 
                (unique_identifier,)
            ).fetchone()
            
            if existing_user:
                return jsonify({'error': 'User already registered'}), 409
                
            # Insert new user
            conn.execute(
                'INSERT INTO users (uniqueIdentifier, email, created_at) VALUES (?, ?, ?)',
                (unique_identifier, email, datetime.now().isoformat())
            )
            conn.commit()
            
        return jsonify({'message': 'User registered successfully'}), 201
        
    except sqlite3.Error as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)