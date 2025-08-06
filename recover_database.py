
#!/usr/bin/env python3
"""
Database Recovery Script
Recovers from SQLite disk I/O errors by rebuilding the database
"""
import sqlite3
import os
import shutil
from datetime import datetime

def recover_database():
    """Recover the database from corruption"""
    db_path = 'engineroom.db'
    backup_path = f'engineroom_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.db'
    
    print("🔧 Starting database recovery...")
    
    # Step 1: Backup existing database if it exists
    if os.path.exists(db_path):
        try:
            print(f"📦 Backing up existing database to {backup_path}")
            shutil.copy2(db_path, backup_path)
        except Exception as e:
            print(f"⚠️ Warning: Could not backup database: {e}")
    
    # Step 2: Remove corrupted files
    files_to_remove = [db_path, f"{db_path}-wal", f"{db_path}-shm"]
    for file_path in files_to_remove:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                print(f"🗑️ Removed {file_path}")
            except Exception as e:
                print(f"⚠️ Could not remove {file_path}: {e}")
    
    # Step 3: Create new database with basic structure
    try:
        print("🏗️ Creating new database...")
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA journal_mode=DELETE")  # Use DELETE mode instead of WAL initially
        conn.execute("PRAGMA synchronous=FULL")
        
        # Create a basic users table to test
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            )
        ''')
        
        conn.commit()
        conn.close()
        print("✅ New database created successfully")
        
    except Exception as e:
        print(f"❌ Failed to create new database: {e}")
        return False
    
    # Step 4: Test the database
    try:
        print("🧪 Testing database connection...")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        conn.close()
        print(f"✅ Database test successful. Tables found: {[t[0] for t in tables]}")
        return True
        
    except Exception as e:
        print(f"❌ Database test failed: {e}")
        return False

if __name__ == "__main__":
    success = recover_database()
    if success:
        print("🎉 Database recovery completed successfully!")
        print("You can now restart your application.")
    else:
        print("💥 Database recovery failed. Manual intervention required.")
