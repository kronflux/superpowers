# Advanced Test Strategy

For complex, high-risk, or hard-to-test behavior, go beyond basic unit tests while still following RED-GREEN-REFACTOR:

- **Integration tests**: Test real interactions between components (database, API, filesystem). Prefer real dependencies over mocks.
- **E2E tests**: For user-facing flows, verify the full path from input to output.
- **Property-based tests**: When behavior has invariants (e.g., "sort output is always ordered"), generate random inputs to find edge cases.
- **Performance tests**: When latency or throughput matters, add benchmarks with clear thresholds.
- **Flaky test diagnosis**: If a test passes/fails inconsistently, treat it as a bug — find the race condition, timing dependency, or shared state causing it.
- **Coverage strategy**: Focus coverage on behavior boundaries and error paths, not line counts. 80% meaningful coverage beats 100% trivial coverage.

Choose appropriate frameworks and libraries for the current stack. Write tests that are fast, deterministic, and maintainable.
