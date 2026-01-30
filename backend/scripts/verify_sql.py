#!/usr/bin/env python3
"""
SQL Verification Script for Supabase

Execute SQL queries against Supabase and display results directly in terminal.
This script allows you to verify database records without manually copying
SQL snippets to the Supabase SQL editor.

Usage:
    # Query as command-line argument
    python3 scripts/verify_sql.py "SELECT * FROM teams LIMIT 5"
    
    # Query from stdin
    echo "SELECT COUNT(*) FROM players" | python3 scripts/verify_sql.py
    
    # Query from file
    python3 scripts/verify_sql.py < query.sql
    
    # Multiple queries (separated by semicolons)
    python3 scripts/verify_sql.py "SELECT * FROM teams; SELECT COUNT(*) FROM players"

Environment Variables:
    DATABASE_URL - Full PostgreSQL connection string (preferred)
        Format: postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
    
    OR use these to construct connection string:
    SUPABASE_URL - Supabase project URL (e.g., https://xxx.supabase.co)
    DATABASE_PASSWORD - PostgreSQL database password
    
    If DATABASE_URL is not set, the script will try to construct it from
    SUPABASE_URL and DATABASE_PASSWORD.
"""

import sys
import os
import re
from pathlib import Path
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ Error: psycopg2-binary is not installed.")
    print("   Install it with: pip install psycopg2-binary")
    sys.exit(1)


def get_connection_string() -> str:
    """Get PostgreSQL connection string from environment variables."""
    # First, try DATABASE_URL (full connection string)
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return database_url
    
    # Otherwise, construct from SUPABASE_URL and DATABASE_PASSWORD
    supabase_url = os.getenv("SUPABASE_URL", "")
    database_password = os.getenv("DATABASE_PASSWORD", "")
    
    if not supabase_url:
        print("❌ Error: DATABASE_URL or SUPABASE_URL must be set")
        print("\nOptions:")
        print("  1. Set DATABASE_URL with full connection string:")
        print("     DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres")
        print("  2. Set SUPABASE_URL and DATABASE_PASSWORD:")
        print("     SUPABASE_URL=https://xxx.supabase.co")
        print("     DATABASE_PASSWORD=your_password")
        sys.exit(1)
    
    if not database_password:
        print("❌ Error: DATABASE_PASSWORD must be set when using SUPABASE_URL")
        print("\nGet your database password from:")
        print("  Supabase Dashboard → Settings → Database → Connection string")
        sys.exit(1)
    
    # Extract project ref from Supabase URL
    # Format: https://[PROJECT].supabase.co or https://[PROJECT].supabase.co/
    parsed = urlparse(supabase_url)
    hostname = parsed.hostname or supabase_url.replace("https://", "").replace("http://", "").split("/")[0]
    
    # Extract project ref (everything before .supabase.co)
    if ".supabase.co" in hostname:
        project_ref = hostname.replace(".supabase.co", "")
    else:
        print(f"❌ Error: Could not extract project ref from SUPABASE_URL: {supabase_url}")
        sys.exit(1)
    
    # Construct connection string
    # Format: postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
    connection_string = f"postgresql://postgres:{database_password}@db.{project_ref}.supabase.co:5432/postgres"
    
    return connection_string


def split_queries(sql: str) -> List[str]:
    """Split SQL string into individual queries (by semicolon)."""
    # Remove comments and split by semicolon
    queries = []
    current_query = []
    in_string = False
    string_char = None
    
    i = 0
    while i < len(sql):
        char = sql[i]
        
        # Track string literals
        if char in ("'", '"') and (i == 0 or sql[i-1] != '\\'):
            if not in_string:
                in_string = True
                string_char = char
            elif char == string_char:
                in_string = False
                string_char = None
        
        current_query.append(char)
        
        # Check for semicolon outside of strings
        if char == ';' and not in_string:
            query = ''.join(current_query).strip()
            if query and not query.startswith('--'):
                queries.append(query)
            current_query = []
        
        i += 1
    
    # Add remaining query if any
    if current_query:
        query = ''.join(current_query).strip()
        if query and not query.startswith('--'):
            queries.append(query)
    
    return queries


def format_result(rows: List[Dict[str, Any]], query: str) -> str:
    """Format query results for display."""
    if not rows:
        return "   (0 rows)\n"
    
    # Get column names
    columns = list(rows[0].keys())
    
    # Calculate column widths
    col_widths = {}
    for col in columns:
        # Minimum width is column name length
        col_widths[col] = len(col)
        # Check all values in this column
        for row in rows:
            value = str(row.get(col, ''))
            col_widths[col] = max(col_widths[col], len(value))
        # Cap at reasonable width for readability
        col_widths[col] = min(col_widths[col], 50)
    
    # Build header
    header_parts = []
    separator_parts = []
    for col in columns:
        width = col_widths[col]
        header_parts.append(col.ljust(width))
        separator_parts.append('-' * width)
    
    header = "   | " + " | ".join(header_parts) + " |"
    separator = "   | " + " | ".join(separator_parts) + " |"
    
    # Build rows
    lines = [header, separator]
    for row in rows:
        row_parts = []
        for col in columns:
            value = str(row.get(col, ''))
            # Truncate long values
            if len(value) > 50:
                value = value[:47] + "..."
            row_parts.append(value.ljust(col_widths[col]))
        lines.append("   | " + " | ".join(row_parts) + " |")
    
    result = "\n".join(lines)
    
    # Add row count
    result += f"\n   ({len(rows)} row{'s' if len(rows) != 1 else ''})\n"
    
    return result


def execute_query(conn, query: str) -> tuple[List[Dict[str, Any]], Optional[str]]:
    """Execute a single SQL query and return results."""
    query = query.strip()
    if not query:
        return [], None
    
    # Remove trailing semicolon if present
    if query.endswith(';'):
        query = query[:-1].strip()
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query)
            
            # Check if query returns rows (SELECT) or modifies data (INSERT/UPDATE/DELETE)
            if cur.description:
                # SELECT query - fetch results
                rows = cur.fetchall()
                return [dict(row) for row in rows], None
            else:
                # DML query - return rowcount
                rowcount = cur.rowcount
                conn.commit()
                return [], f"   Query executed successfully ({rowcount} row{'s' if rowcount != 1 else ''} affected)\n"
    
    except Exception as e:
        return [], f"   ❌ Error: {str(e)}\n"


def main():
    """Main entry point."""
    # Load environment variables from .env file if it exists
    try:
        from dotenv import load_dotenv
        backend_dir = Path(__file__).parent.parent
        env_file = backend_dir / ".env"
        if env_file.exists():
            load_dotenv(env_file)
    except ImportError:
        pass  # python-dotenv not required if using system env vars
    
    # Get SQL query from command line, stdin, or file
    if len(sys.argv) > 1:
        # Query from command-line arguments
        sql = " ".join(sys.argv[1:])
    else:
        # Query from stdin
        sql = sys.stdin.read()
    
    if not sql.strip():
        print("❌ Error: No SQL query provided")
        print("\nUsage:")
        print("  python3 scripts/verify_sql.py \"SELECT * FROM teams LIMIT 5\"")
        print("  echo \"SELECT COUNT(*) FROM players\" | python3 scripts/verify_sql.py")
        sys.exit(1)
    
    # Get connection string
    try:
        conn_string = get_connection_string()
    except SystemExit:
        sys.exit(1)
    
    # Connect to database
    try:
        conn = psycopg2.connect(conn_string)
    except Exception as e:
        print(f"❌ Error connecting to database: {e}")
        print("\nPlease check:")
        print("  1. DATABASE_URL is correct, or")
        print("  2. SUPABASE_URL and DATABASE_PASSWORD are set correctly")
        sys.exit(1)
    
    try:
        # Split into multiple queries if semicolons are present
        queries = split_queries(sql)
        
        if not queries:
            print("❌ Error: No valid SQL queries found")
            sys.exit(1)
        
        # Execute each query
        for i, query in enumerate(queries, 1):
            if len(queries) > 1:
                print(f"\n📋 Query {i}/{len(queries)}:")
                print(f"   {query[:100]}{'...' if len(query) > 100 else ''}\n")
            else:
                print(f"📋 Executing query...\n")
            
            rows, message = execute_query(conn, query)
            
            if message:
                # DML query or error
                print(message)
            else:
                # SELECT query - display results
                result = format_result(rows, query)
                print(result)
        
        print("✅ Query execution complete!")
    
    except KeyboardInterrupt:
        print("\n\n⚠️  Query execution interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
