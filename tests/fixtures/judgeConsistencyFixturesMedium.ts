/**
 * Medium complexity test fixtures for judge consistency testing.
 * These scenarios test more realistic code changes including:
 * - Nested loops with error handling
 * - State mutations across methods
 * - Multi-file changes
 * - Async refactoring patterns
 */

import type { DiffPair } from "./judgeConsistencyFixtures.js";

/**
 * Logic Equivalence Medium Complexity Fixtures
 */
export const logicEquivalenceMediumFixtures = {
  /**
   * Perfect Match: Nested loops with error handling
   * Both implement the same retry logic with exponential backoff
   */
  perfect: {
    reference: `diff --git a/src/retry_handler.py b/src/retry_handler.py
index 1234567..abcdefg 100644
--- a/src/retry_handler.py
+++ b/src/retry_handler.py
@@ -10,6 +10,25 @@ class RetryHandler:
     def __init__(self, max_retries=3):
         self.max_retries = max_retries
+
+    def execute_with_retry(self, func, *args, **kwargs):
+        """Execute function with exponential backoff retry logic."""
+        last_exception = None
+
+        for attempt in range(self.max_retries):
+            try:
+                result = func(*args, **kwargs)
+                return result
+            except Exception as e:
+                last_exception = e
+                if attempt < self.max_retries - 1:
+                    wait_time = 2 ** attempt  # Exponential backoff
+                    time.sleep(wait_time)
+                    continue
+                # Last attempt failed, raise
+                break
+
+        raise last_exception

     def reset(self):
         pass`,
    candidate: `diff --git a/src/retry_handler.py b/src/retry_handler.py
index 1234567..abcdefg 100644
--- a/src/retry_handler.py
+++ b/src/retry_handler.py
@@ -10,6 +10,25 @@ class RetryHandler:
     def __init__(self, max_retries=3):
         self.max_retries = max_retries
+
+    def execute_with_retry(self, func, *args, **kwargs):
+        """Execute function with exponential backoff retry logic."""
+        last_exception = None
+
+        for attempt in range(self.max_retries):
+            try:
+                result = func(*args, **kwargs)
+                return result
+            except Exception as e:
+                last_exception = e
+                if attempt < self.max_retries - 1:
+                    wait_time = 2 ** attempt  # Exponential backoff
+                    time.sleep(wait_time)
+                    continue
+                # Last attempt failed, raise
+                break
+
+        raise last_exception

     def reset(self):
         pass`,
  } as DiffPair,

  /**
   * Wrong: State mutation with subtle bug
   * Reference correctly updates all state, candidate misses one update
   */
  wrong: {
    reference: `diff --git a/src/cache_manager.py b/src/cache_manager.py
index 2345678..bcdefgh 100644
--- a/src/cache_manager.py
+++ b/src/cache_manager.py
@@ -15,6 +15,18 @@ class CacheManager:
         self.hits = 0
         self.misses = 0
+
+    def invalidate_pattern(self, pattern):
+        """Invalidate all cache keys matching pattern."""
+        keys_to_remove = []
+        for key in self.cache.keys():
+            if pattern in key:
+                keys_to_remove.append(key)
+
+        for key in keys_to_remove:
+            del self.cache[key]
+            self.size -= 1  # Update size counter
+            self.misses += 1  # Track invalidations as misses

     def get(self, key):
         if key in self.cache:`,
    candidate: `diff --git a/src/cache_manager.py b/src/cache_manager.py
index 2345678..bcdefgh 100644
--- a/src/cache_manager.py
+++ b/src/cache_manager.py
@@ -15,6 +15,17 @@ class CacheManager:
         self.hits = 0
         self.misses = 0
+
+    def invalidate_pattern(self, pattern):
+        """Invalidate all cache keys matching pattern."""
+        keys_to_remove = []
+        for key in self.cache.keys():
+            if pattern in key:
+                keys_to_remove.append(key)
+
+        for key in keys_to_remove:
+            del self.cache[key]
+            self.size -= 1  # Update size counter
+            # BUG: Missing misses increment!

     def get(self, key):
         if key in self.cache:`,
  } as DiffPair,

  /**
   * Ambiguous: Async/await refactor
   * Reference uses async/await, candidate uses callbacks
   * Logically equivalent but different patterns
   */
  ambiguous: {
    reference: `diff --git a/src/data_fetcher.py b/src/data_fetcher.py
index 3456789..cdefghi 100644
--- a/src/data_fetcher.py
+++ b/src/data_fetcher.py
@@ -8,6 +8,16 @@ class DataFetcher:
     def __init__(self, api_client):
         self.client = api_client
+
+    async def fetch_user_data(self, user_id):
+        """Fetch user data with error handling."""
+        try:
+            response = await self.client.get(f"/users/{user_id}")
+            data = await response.json()
+            return data
+        except Exception as e:
+            logger.error(f"Failed to fetch user {user_id}: {e}")
+            return None

     def process(self, data):
         return data`,
    candidate: `diff --git a/src/data_fetcher.py b/src/data_fetcher.py
index 3456789..cdefghi 100644
--- a/src/data_fetcher.py
+++ b/src/data_fetcher.py
@@ -8,6 +8,19 @@ class DataFetcher:
     def __init__(self, api_client):
         self.client = api_client
+
+    def fetch_user_data(self, user_id, callback):
+        """Fetch user data with error handling (callback style)."""
+        def on_success(response):
+            data = response.json()
+            callback(None, data)
+
+        def on_error(error):
+            logger.error(f"Failed to fetch user {user_id}: {error}")
+            callback(None, None)
+
+        self.client.get(f"/users/{user_id}", on_success, on_error)

     def process(self, data):
         return data`,
  } as DiffPair,
};

/**
 * API Signature Medium Complexity Fixtures
 */
export const apiSignatureMediumFixtures = {
  /**
   * Perfect Match: Multi-file signature change
   * Function signature changed in definition and all call sites updated
   */
  perfect: {
    reference: `diff --git a/src/utils/formatter.py b/src/utils/formatter.py
index 4567890..defghij 100644
--- a/src/utils/formatter.py
+++ b/src/utils/formatter.py
@@ -5,7 +5,7 @@ def format_timestamp(ts):
     return str(ts)
-def format_data(data, include_metadata=False):
+def format_data(data, include_metadata=False, timezone="UTC"):
     """Format data for display."""
     result = {"values": data}
     if include_metadata:
diff --git a/src/handlers/api.py b/src/handlers/api.py
index 5678901..efghijk 100644
--- a/src/handlers/api.py
+++ b/src/handlers/api.py
@@ -15,7 +15,7 @@ def get_data(request):
     data = fetch_data(request.id)
-    formatted = format_data(data, include_metadata=True)
+    formatted = format_data(data, include_metadata=True, timezone="UTC")
     return formatted
diff --git a/src/handlers/export.py b/src/handlers/export.py
index 6789012..fghijkl 100644
--- a/src/handlers/export.py
+++ b/src/handlers/export.py
@@ -20,7 +20,7 @@ def export_report(data):
     """Export data as report."""
-    formatted = format_data(data, include_metadata=False)
+    formatted = format_data(data, include_metadata=False, timezone="UTC")
     return generate_pdf(formatted)`,
    candidate: `diff --git a/src/utils/formatter.py b/src/utils/formatter.py
index 4567890..defghij 100644
--- a/src/utils/formatter.py
+++ b/src/utils/formatter.py
@@ -5,7 +5,7 @@ def format_timestamp(ts):
     return str(ts)
-def format_data(data, include_metadata=False):
+def format_data(data, include_metadata=False, timezone="UTC"):
     """Format data for display."""
     result = {"values": data}
     if include_metadata:
diff --git a/src/handlers/api.py b/src/handlers/api.py
index 5678901..efghijk 100644
--- a/src/handlers/api.py
+++ b/src/handlers/api.py
@@ -15,7 +15,7 @@ def get_data(request):
     data = fetch_data(request.id)
-    formatted = format_data(data, include_metadata=True)
+    formatted = format_data(data, include_metadata=True, timezone="UTC")
     return formatted
diff --git a/src/handlers/export.py b/src/handlers/export.py
index 6789012..fghijkl 100644
--- a/src/handlers/export.py
+++ b/src/handlers/export.py
@@ -20,7 +20,7 @@ def export_report(data):
     """Export data as report."""
-    formatted = format_data(data, include_metadata=False)
+    formatted = format_data(data, include_metadata=False, timezone="UTC")
     return generate_pdf(formatted)`,
  } as DiffPair,

  /**
   * Wrong: Optional parameter breaks existing usage
   * Reference makes parameter truly optional with default
   * Candidate changes parameter order, breaking existing calls
   */
  wrong: {
    reference: `diff --git a/src/processor.py b/src/processor.py
index 7890123..ghijklm 100644
--- a/src/processor.py
+++ b/src/processor.py
@@ -10,7 +10,7 @@ class Processor:
         self.config = config
-    def process(self, data, validate):
+    def process(self, data, validate=True):
         """Process data with optional validation."""
         if validate:
             check_data(data)`,
    candidate: `diff --git a/src/processor.py b/src/processor.py
index 7890123..ghijklm 100644
--- a/src/processor.py
+++ b/src/processor.py
@@ -10,7 +10,7 @@ class Processor:
         self.config = config
-    def process(self, data, validate):
+    def process(self, validate=True, data=None):
         """Process data with optional validation."""
         if validate:
             check_data(data)`,
  } as DiffPair,

  /**
   * Ambiguous: Type annotation addition
   * Reference adds type hints, candidate doesn't
   * Functionally equivalent but different styles
   */
  ambiguous: {
    reference: `diff --git a/src/calculator.py b/src/calculator.py
index 8901234..hijklmn 100644
--- a/src/calculator.py
+++ b/src/calculator.py
@@ -5,8 +5,8 @@ class Calculator:
     def __init__(self):
         self.result = 0
-    def add(self, a, b):
-        """Add two numbers."""
+    def add(self, a: float, b: float) -> float:
+        """Add two numbers with type annotations."""
         return a + b`,
    candidate: `diff --git a/src/calculator.py b/src/calculator.py
index 8901234..hijklmn 100644
--- a/src/calculator.py
+++ b/src/calculator.py
@@ -5,7 +5,7 @@ class Calculator:
     def __init__(self):
         self.result = 0
     def add(self, a, b):
-        """Add two numbers."""
+        """Add two numbers (no type hints)."""
         return a + b`,
  } as DiffPair,
};

/**
 * Integration Points Medium Complexity Fixtures
 */
export const integrationPointsMediumFixtures = {
  /**
   * Perfect Match: Import reorganization
   * Both reorganize imports identically across multiple files
   */
  perfect: {
    reference: `diff --git a/src/handlers/webhook.py b/src/handlers/webhook.py
index 9012345..ijklmno 100644
--- a/src/handlers/webhook.py
+++ b/src/handlers/webhook.py
@@ -1,8 +1,8 @@
 import json
 import logging
-from utils import validate_signature, parse_payload
-from processors import process_event
+from utils.validation import validate_signature
+from utils.parsing import parse_payload
+from processors.events import process_event

 logger = logging.getLogger(__name__)
diff --git a/src/handlers/api.py b/src/handlers/api.py
index 0123456..jklmnop 100644
--- a/src/handlers/api.py
+++ b/src/handlers/api.py
@@ -1,6 +1,7 @@
 import json
-from utils import validate_signature
+from utils.validation import validate_signature

 def handle_request(request):
     validate_signature(request.headers)`,
    candidate: `diff --git a/src/handlers/webhook.py b/src/handlers/webhook.py
index 9012345..ijklmno 100644
--- a/src/handlers/webhook.py
+++ b/src/handlers/webhook.py
@@ -1,8 +1,8 @@
 import json
 import logging
-from utils import validate_signature, parse_payload
-from processors import process_event
+from utils.validation import validate_signature
+from utils.parsing import parse_payload
+from processors.events import process_event

 logger = logging.getLogger(__name__)
diff --git a/src/handlers/api.py b/src/handlers/api.py
index 0123456..jklmnop 100644
--- a/src/handlers/api.py
+++ b/src/handlers/api.py
@@ -1,6 +1,7 @@
 import json
-from utils import validate_signature
+from utils.validation import validate_signature

 def handle_request(request):
     validate_signature(request.headers)`,
  } as DiffPair,

  /**
   * Wrong: Missing import after refactor
   * Reference updates all imports, candidate misses one
   */
  wrong: {
    reference: `diff --git a/src/services/auth.py b/src/services/auth.py
index 1234567..klmnopq 100644
--- a/src/services/auth.py
+++ b/src/services/auth.py
@@ -1,5 +1,6 @@
 from datetime import datetime
 from jwt import encode, decode
+from crypto.hashing import hash_password

 class AuthService:
     def __init__(self):
@@ -10,6 +11,7 @@ class AuthService:
     def register_user(self, username, password):
         """Register a new user."""
+        hashed = hash_password(password)
         user = {
             "username": username,
-            "password": password,
+            "password": hashed,
         }
diff --git a/src/services/login.py b/src/services/login.py
index 2345678..lmnopqr 100644
--- a/src/services/login.py
+++ b/src/services/login.py
@@ -1,4 +1,5 @@
 from jwt import decode
+from crypto.hashing import hash_password

 def verify_credentials(username, password, stored_hash):
-    return password == stored_hash
+    return hash_password(password) == stored_hash`,
    candidate: `diff --git a/src/services/auth.py b/src/services/auth.py
index 1234567..klmnopq 100644
--- a/src/services/auth.py
+++ b/src/services/auth.py
@@ -1,5 +1,6 @@
 from datetime import datetime
 from jwt import encode, decode
+from crypto.hashing import hash_password

 class AuthService:
     def __init__(self):
@@ -10,6 +11,7 @@ class AuthService:
     def register_user(self, username, password):
         """Register a new user."""
+        hashed = hash_password(password)
         user = {
             "username": username,
-            "password": password,
+            "password": hashed,
         }
diff --git a/src/services/login.py b/src/services/login.py
index 2345678..lmnopqr 100644
--- a/src/services/login.py
+++ b/src/services/login.py
@@ -1,4 +1,4 @@
 from jwt import decode
+# BUG: Missing import for hash_password!

 def verify_credentials(username, password, stored_hash):
-    return password == stored_hash
+    return hash_password(password) == stored_hash`,
  } as DiffPair,

  /**
   * Ambiguous: Import alias change
   * Reference uses explicit imports, candidate uses aliases
   * Functionally equivalent
   */
  ambiguous: {
    reference: `diff --git a/src/analytics/tracker.py b/src/analytics/tracker.py
index 3456789..mnopqrs 100644
--- a/src/analytics/tracker.py
+++ b/src/analytics/tracker.py
@@ -1,6 +1,6 @@
-from metrics import counter, gauge, histogram
+from metrics.primitives import Counter, Gauge, Histogram

 class Tracker:
     def __init__(self):
-        self.requests = counter("requests")
-        self.latency = histogram("latency")
+        self.requests = Counter("requests")
+        self.latency = Histogram("latency")`,
    candidate: `diff --git a/src/analytics/tracker.py b/src/analytics/tracker.py
index 3456789..mnopqrs 100644
--- a/src/analytics/tracker.py
+++ b/src/analytics/tracker.py
@@ -1,6 +1,6 @@
-from metrics import counter, gauge, histogram
+import metrics.primitives as mp

 class Tracker:
     def __init__(self):
-        self.requests = counter("requests")
-        self.latency = histogram("latency")
+        self.requests = mp.Counter("requests")
+        self.latency = mp.Histogram("latency")`,
  } as DiffPair,
};
