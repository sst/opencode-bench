/**
 * Static diff fixtures for judge consistency testing.
 * Each fixture contains a reference diff and candidate diff pair.
 */

export interface DiffPair {
  reference: string;
  candidate: string;
}

/**
 * Logic Equivalence Test Fixtures
 *
 * These fixtures test whether judges consistently evaluate logical behavior.
 */
export const logicEquivalenceFixtures = {
  /**
   * Perfect Match: Candidate diff is identical to reference diff.
   * Expected: Should consistently score 1 across all runs.
   */
  perfect: {
    reference: `diff --git a/src/handler.py b/src/handler.py
index 1234567..abcdefg 100644
--- a/src/handler.py
+++ b/src/handler.py
@@ -10,6 +10,12 @@ def process_response(response):
     if response is None:
         return

+    if not isinstance(response, dict):
+        return
+
+    failures = response.get("batchItemFailures")
+    if isinstance(failures, list):
+        emit_metric("batch.failures", len(failures))
+
     return response`,
    candidate: `diff --git a/src/handler.py b/src/handler.py
index 1234567..abcdefg 100644
--- a/src/handler.py
+++ b/src/handler.py
@@ -10,6 +10,12 @@ def process_response(response):
     if response is None:
         return

+    if not isinstance(response, dict):
+        return
+
+    failures = response.get("batchItemFailures")
+    if isinstance(failures, list):
+        emit_metric("batch.failures", len(failures))
+
     return response`,
  } as DiffPair,

  /**
   * Clear Mismatch: Candidate adds an extra condition that changes behavior.
   * Reference emits metric even when failures list is empty (count=0).
   * Candidate only emits when count > 0, changing the behavior.
   * Expected: Should consistently score 0 across all runs.
   */
  wrong: {
    reference: `diff --git a/src/metrics.py b/src/metrics.py
index 2345678..bcdefgh 100644
--- a/src/metrics.py
+++ b/src/metrics.py
@@ -15,6 +15,9 @@ def report_batch_status(response):
         return

     failures = response.get("batchItemFailures")
+    if failures is not None and isinstance(failures, list):
+        # Emit metric even for empty list (count=0)
+        emit_metric("batch.failures", len(failures))

     return response`,
    candidate: `diff --git a/src/metrics.py b/src/metrics.py
index 2345678..bcdefgh 100644
--- a/src/metrics.py
+++ b/src/metrics.py
@@ -15,6 +15,10 @@ def report_batch_status(response):
         return

     failures = response.get("batchItemFailures")
+    if failures is not None and isinstance(failures, list):
+        count = len(failures)
+        if count > 0:  # Extra condition - only emit when count > 0
+            emit_metric("batch.failures", count)

     return response`,
  } as DiffPair,

  /**
   * Ambiguous/Borderline: Both implement the same logic but with different patterns.
   * Reference uses guard clauses (early returns).
   * Candidate uses nested if statements.
   * Logically equivalent, but judge might interpret differently.
   * Expected: Should be consistent (all 0s or all 1s, doesn't matter which).
   */
  ambiguous: {
    reference: `diff --git a/src/validator.py b/src/validator.py
index 3456789..cdefghi 100644
--- a/src/validator.py
+++ b/src/validator.py
@@ -20,6 +20,14 @@ def validate_and_emit(response):
     """Validate response and emit metrics."""
     if response is None:
         return
+
+    if not isinstance(response, dict):
+        return
+
+    failures = response.get("batchItemFailures")
+
+    if isinstance(failures, list):
+        emit_metric("batch.failures", len(failures))

     return response`,
    candidate: `diff --git a/src/validator.py b/src/validator.py
index 3456789..cdefghi 100644
--- a/src/validator.py
+++ b/src/validator.py
@@ -20,6 +20,12 @@ def validate_and_emit(response):
     """Validate response and emit metrics."""
     if response is None:
         return
+
+    if isinstance(response, dict):
+        failures = response.get("batchItemFailures")
+
+        if isinstance(failures, list):
+            emit_metric("batch.failures", len(failures))

     return response`,
  } as DiffPair,
};

/**
 * API Signature Test Fixtures
 *
 * These fixtures test whether judges consistently evaluate API signatures.
 */
export const apiSignatureFixtures = {
  /**
   * Perfect Match: Function signatures match exactly.
   * Expected: Should consistently score 1 across all runs.
   */
  perfect: {
    reference: `diff --git a/src/api.py b/src/api.py
index 4567890..defghij 100644
--- a/src/api.py
+++ b/src/api.py
@@ -5,3 +5,7 @@ class DataProcessor:
     def __init__(self):
         self.data = []
+
+    def process_batch(self, items: list, validate: bool = True) -> dict:
+        """Process a batch of items."""
+        return {"processed": len(items)}`,
    candidate: `diff --git a/src/api.py b/src/api.py
index 4567890..defghij 100644
--- a/src/api.py
+++ b/src/api.py
@@ -5,3 +5,7 @@ class DataProcessor:
     def __init__(self):
         self.data = []
+
+    def process_batch(self, items: list, validate: bool = True) -> dict:
+        """Process a batch of items."""
+        return {"processed": len(items)}`,
  } as DiffPair,

  /**
   * Clear Mismatch: Parameter name changed.
   * Reference: process_batch(items, validate)
   * Candidate: process_batch(data, validate) - parameter name differs
   * Expected: Should consistently score 0 across all runs.
   */
  wrong: {
    reference: `diff --git a/src/api.py b/src/api.py
index 5678901..efghijk 100644
--- a/src/api.py
+++ b/src/api.py
@@ -8,3 +8,6 @@ class DataProcessor:
         self.data = []
+
+    def process_batch(self, items: list, validate: bool = True) -> dict:
+        return {"processed": len(items)}`,
    candidate: `diff --git a/src/api.py b/src/api.py
index 5678901..efghijk 100644
--- a/src/api.py
+++ b/src/api.py
@@ -8,3 +8,6 @@ class DataProcessor:
         self.data = []
+
+    def process_batch(self, data: list, validate: bool = True) -> dict:
+        return {"processed": len(data)}`,
  } as DiffPair,

  /**
   * Ambiguous: Parameter order changed.
   * Reference: process_batch(items, validate)
   * Candidate: process_batch(validate, items) - different order
   * This might be considered a breaking change or acceptable depending on interpretation.
   * Expected: Should be consistent (all 0s or all 1s).
   */
  ambiguous: {
    reference: `diff --git a/src/api.py b/src/api.py
index 6789012..fghijkl 100644
--- a/src/api.py
+++ b/src/api.py
@@ -10,3 +10,6 @@ class DataProcessor:
         return []
+
+    def filter_items(self, items: list, enabled: bool) -> list:
+        return [i for i in items if enabled]`,
    candidate: `diff --git a/src/api.py b/src/api.py
index 6789012..fghijkl 100644
--- a/src/api.py
+++ b/src/api.py
@@ -10,3 +10,6 @@ class DataProcessor:
         return []
+
+    def filter_items(self, enabled: bool, items: list) -> list:
+        return [i for i in items if enabled]`,
  } as DiffPair,
};
