from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
from flask_cors import CORS  # Import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# SQLite database setup
DATABASE = 'watchtime.db'

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS watchtime (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uniqueIdentifier TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                watchtime INTEGER NOT NULL
            )
        ''')
        conn.commit()

# Initialize the database
init_db()

@app.route('/update', methods=['POST'])
def update_watchtime():
    data = request.json
    print(data)
    watchtime = data.get('watchtime')  # Watchtime in milliseconds
    uniqueIdentifier = data.get('uniqueIdentifier')  # Unique identifier
    timestamp = datetime.now().isoformat()  # Current timestamp

    # Save to SQLite database
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            INSERT INTO watchtime (uniqueIdentifier, timestamp, watchtime)
            VALUES (?, ?, ?)
        ''', (uniqueIdentifier, timestamp, watchtime))
        conn.commit()

    # Log the received data
    print(f"Received data from {uniqueIdentifier}: {data}")
    return jsonify({"status": "success", "message": "Data received"})

@app.route('/get-watchtime', methods=['GET'])
def get_watchtime():
    uniqueIdentifier = request.args.get('uniqueIdentifier')  # Get unique identifier from query params
    print(uniqueIdentifier)
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