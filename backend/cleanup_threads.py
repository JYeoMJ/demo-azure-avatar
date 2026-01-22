#!/usr/bin/env python3
"""
Cleanup script to delete all Azure AI Foundry Agent threads.
Run this once to clean up threads that accumulated before the fix.
"""

import os
from dotenv import load_dotenv
from azure.ai.agents import AgentsClient
from azure.identity import DefaultAzureCredential

# Load environment variables
load_dotenv()

FOUNDRY_ENDPOINT = os.getenv("FOUNDRY_ENDPOINT")

if not FOUNDRY_ENDPOINT:
    print("Error: FOUNDRY_ENDPOINT not set in .env")
    exit(1)

print(f"Connecting to: {FOUNDRY_ENDPOINT}")

client = AgentsClient(
    endpoint=FOUNDRY_ENDPOINT,
    credential=DefaultAzureCredential(),
)

# List all threads
print("Fetching threads...")
threads = list(client.threads.list())
total = len(threads)

if total == 0:
    print("No threads found. Nothing to clean up.")
    exit(0)

print(f"Found {total} threads to delete.\n")

# Delete each thread
deleted = 0
errors = 0

for thread in threads:
    try:
        client.threads.delete(thread.id)
        deleted += 1
        print(f"[{deleted}/{total}] Deleted: {thread.id}")
    except Exception as e:
        errors += 1
        print(f"[ERROR] Failed to delete {thread.id}: {e}")

print("\nCleanup complete!")
print(f"  Deleted: {deleted}")
print(f"  Errors:  {errors}")
