#!/usr/bin/env python3
"""
Keep-alive for Claude Code session.
Opens a separate terminal and types a harmless message every 40 min.
Run in ANOTHER terminal: python3 keep_alive.py
"""
import time, sys, os
from datetime import datetime

INTERVAL = 40 * 60  # 40 minutes in seconds

def main():
    print(f"Keep-alive running. Ping every 40 min. Ctrl+C to stop.\n")
    cycle = 0
    while True:
        time.sleep(INTERVAL)
        cycle += 1
        now = datetime.now().strftime("%H:%M:%S")
        # Write to stdout so the terminal stays active
        print(f"[{now}] Cycle {cycle}: session keep-alive ping")
        sys.stdout.flush()
        # Touch a file as a heartbeat signal
        os.utime(__file__, None)

if __name__ == "__main__":
    main()
