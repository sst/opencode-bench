/**
 * High complexity test fixtures for judge consistency testing.
 * These scenarios test very challenging code changes:
 * - Architectural refactors (class → function)
 * - Cross-cutting concerns (logging/metrics added everywhere)
 * - Test changes matching implementation
 */

import type { DiffPair } from "./judgeConsistencyFixtures.js";

/**
 * Logic Equivalence Complex Fixtures
 */
export const logicEquivalenceComplexFixtures = {
  /**
   * Perfect: Architectural refactor (class → standalone functions)
   * Both refactor from OOP to functional style identically
   */
  perfect: {
    reference: `diff --git a/src/processor.py b/src/processor.py
index 1234567..abcdefg 100644
--- a/src/processor.py
+++ b/src/processor.py
@@ -1,20 +1,25 @@
-class DataProcessor:
-    def __init__(self, config):
-        self.config = config
-        self.cache = {}
+# Refactored to functional style
+_cache = {}
+_config = None
-    def process(self, data):
-        if data in self.cache:
-            return self.cache[data]
+def initialize(config):
+    """Initialize processor with config."""
+    global _config
+    _config = config
-        result = transform(data, self.config)
-        self.cache[data] = result
-        return result
+def process(data):
+    """Process data with caching."""
+    if data in _cache:
+        return _cache[data]
+
+    result = transform(data, _config)
+    _cache[data] = result
+    return result
-    def clear_cache(self):
-        self.cache.clear()
+def clear_cache():
+    """Clear the cache."""
+    _cache.clear()`,
    candidate: `diff --git a/src/processor.py b/src/processor.py
index 1234567..abcdefg 100644
--- a/src/processor.py
+++ b/src/processor.py
@@ -1,20 +1,25 @@
-class DataProcessor:
-    def __init__(self, config):
-        self.config = config
-        self.cache = {}
+# Refactored to functional style
+_cache = {}
+_config = None
-    def process(self, data):
-        if data in self.cache:
-            return self.cache[data]
+def initialize(config):
+    """Initialize processor with config."""
+    global _config
+    _config = config
-        result = transform(data, self.config)
-        self.cache[data] = result
-        return result
+def process(data):
+    """Process data with caching."""
+    if data in _cache:
+        return _cache[data]
+
+    result = transform(data, _config)
+    _cache[data] = result
+    return result
-    def clear_cache(self):
-        self.cache.clear()
+def clear_cache():
+    """Clear the cache."""
+    _cache.clear()`,
  } as DiffPair,

  /**
   * Wrong: Cross-cutting concern with missing application
   * Reference adds logging to all methods, candidate misses one
   */
  wrong: {
    reference: `diff --git a/src/api_handler.py b/src/api_handler.py
index 2345678..bcdefgh 100644
--- a/src/api_handler.py
+++ b/src/api_handler.py
@@ -5,18 +5,24 @@ class APIHandler:
         self.client = client
     def fetch(self, url):
+        logger.info(f"Fetching: {url}")
         return self.client.get(url)
    def post(self, url, data):
+        logger.info(f"Posting to: {url}")
         return self.client.post(url, data)
    def delete(self, url):
+        logger.info(f"Deleting: {url}")
         return self.client.delete(url)`,
    candidate: `diff --git a/src/api_handler.py b/src/api_handler.py
index 2345678..bcdefgh 100644
--- a/src/api_handler.py
+++ b/src/api_handler.py
@@ -5,16 +5,20 @@ class APIHandler:
         self.client = client
    def fetch(self, url):
+        logger.info(f"Fetching: {url}")
         return self.client.get(url)
    def post(self, url, data):
+        logger.info(f"Posting to: {url}")
         return self.client.post(url, data)
    def delete(self, url):
+        # BUG: Missing logging here!
         return self.client.delete(url)`,
  } as DiffPair,

  /**
   * Ambiguous: Sync → Async refactor
   * Different but logically equivalent patterns
   */
  ambiguous: {
    reference: `diff --git a/src/fetcher.py b/src/fetcher.py
index 3456789..cdefghi 100644
--- a/src/fetcher.py
+++ b/src/fetcher.py
@@ -5,10 +5,11 @@ def fetch_all(urls):
-    results = []
-    for url in urls:
-        data = requests.get(url).json()
-        results.append(data)
-    return results
+    import asyncio
+    async def fetch_one(url):
+        return await aiohttp.get(url).json()
+
+    async def fetch_all_async():
+        return await asyncio.gather(*[fetch_one(u) for u in urls])
+
+    return asyncio.run(fetch_all_async())`,
    candidate: `diff --git a/src/fetcher.py b/src/fetcher.py
index 3456789..cdefghi 100644
--- a/src/fetcher.py
+++ b/src/fetcher.py
@@ -5,8 +5,10 @@ def fetch_all(urls):
-    results = []
-    for url in urls:
-        data = requests.get(url).json()
-        results.append(data)
-    return results
+    from concurrent.futures import ThreadPoolExecutor
+
+    def fetch_one(url):
+        return requests.get(url).json()
+
+    with ThreadPoolExecutor() as executor:
+        return list(executor.map(fetch_one, urls))`,
  } as DiffPair,
};

/**
 * Test Coverage Complex Fixtures
 * (Using test-coverage judge - not exported yet, but illustrative)
 */
export const testCoverageComplexFixtures = {
  /**
   * Perfect: Tests added matching implementation
   */
  perfect: {
    reference: `diff --git a/tests/test_validator.py b/tests/test_validator.py
index 4567890..defghij 100644
--- a/tests/test_validator.py
+++ b/tests/test_validator.py
@@ -10,3 +10,15 @@ def test_basic_validation():
     result = validate(data)
     assert result is True
+
+def test_validation_with_null_values():
+    data = {"name": None, "age": 25}
+    result = validate(data)
+    assert result is False
+
+def test_validation_with_missing_fields():
+    data = {"name": "Alice"}
+    result = validate(data)
+    assert result is False`,
    candidate: `diff --git a/tests/test_validator.py b/tests/test_validator.py
index 4567890..defghij 100644
--- a/tests/test_validator.py
+++ b/tests/test_validator.py
@@ -10,3 +10,15 @@ def test_basic_validation():
     result = validate(data)
     assert result is True
+
+def test_validation_with_null_values():
+    data = {"name": None, "age": 25}
+    result = validate(data)
+    assert result is False
+
+def test_validation_with_missing_fields():
+    data = {"name": "Alice"}
+    result = validate(data)
+    assert result is False`,
  } as DiffPair,

  /**
   * Wrong: Tests incomplete (missing edge case)
   */
  wrong: {
    reference: `diff --git a/tests/test_calculator.py b/tests/test_calculator.py
index 5678901..efghijk 100644
--- a/tests/test_calculator.py
+++ b/tests/test_calculator.py
@@ -5,3 +5,12 @@ def test_add():
     assert add(2, 3) == 5
+
+def test_add_negative():
+    assert add(-2, 3) == 1
+
+def test_add_zero():
+    assert add(0, 5) == 5
+
+def test_add_floats():
+    assert add(1.5, 2.5) == 4.0`,
    candidate: `diff --git a/tests/test_calculator.py b/tests/test_calculator.py
index 5678901..efghijk 100644
--- a/tests/test_calculator.py
+++ b/tests/test_calculator.py
@@ -5,3 +5,9 @@ def test_add():
     assert add(2, 3) == 5
+
+def test_add_negative():
+    assert add(-2, 3) == 1
+
+def test_add_zero():
+    assert add(0, 5) == 5
+# BUG: Missing test_add_floats!`,
  } as DiffPair,

  /**
   * Ambiguous: Different test approach (table-driven vs individual)
   */
  ambiguous: {
    reference: `diff --git a/tests/test_math.py b/tests/test_math.py
index 6789012..fghijkl 100644
--- a/tests/test_math.py
+++ b/tests/test_math.py
@@ -1,3 +1,15 @@
+def test_multiply_positive():
+    assert multiply(3, 4) == 12
+
+def test_multiply_negative():
+    assert multiply(-3, 4) == -12
+
+def test_multiply_zero():
+    assert multiply(0, 5) == 0
+
+def test_multiply_floats():
+    assert multiply(2.5, 4.0) == 10.0`,
    candidate: `diff --git a/tests/test_math.py b/tests/test_math.py
index 6789012..fghijkl 100644
--- a/tests/test_math.py
+++ b/tests/test_math.py
@@ -1,3 +1,11 @@
+import pytest
+
+@pytest.mark.parametrize("a,b,expected", [
+    (3, 4, 12),
+    (-3, 4, -12),
+    (0, 5, 0),
+    (2.5, 4.0, 10.0),
+])
+def test_multiply(a, b, expected):
+    assert multiply(a, b) == expected`,
  } as DiffPair,
};
