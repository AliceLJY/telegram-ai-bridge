# telegram-ai-bridge agent rules

These rules apply to any agent working in this repository.

## 1. Plan before coding

- For any non-trivial task, inspect the relevant files first and write a short execution plan before editing.
- If the request is ambiguous, high-risk, or likely to affect multiple modules, stop at the plan and wait for confirmation before implementing.
- Break large requests into explicit steps instead of jumping straight into code.

## 2. Follow repo constraints

- Use `bun` for runtime, scripts, and tests unless the task explicitly requires another tool.
- Keep the existing ESM style and current project structure.
- Avoid introducing new dependencies unless the change clearly needs them.
- Prefer small, targeted edits over broad rewrites.

## 3. Closed-loop verification is mandatory

- After changing code, run the smallest relevant verification yourself before reporting back.
- If a test or command fails, read the failure, fix it, and rerun it. Do not hand raw failures back to the user as the first response.
- Use `bun test` for repository tests unless a narrower command is more appropriate.
- Only report completion after the relevant checks pass, or clearly state what could not be verified.

## 4. Make workflow reusable

- If a repetitive task appears more than once, prefer encoding it in a script or reusable skill instead of repeating manual steps.
- If a new verification command is important for future work, expose it through `package.json`.

## 5. UI work requires visual validation

- For UI-facing changes, do not stop at static code edits.
- Run the available browser or screenshot-based validation flow when the repo supports it.
- Check responsive behavior and obvious visual regressions before handing work back.

## 6. Communicate like an operator

- Keep updates concise and concrete.
- State assumptions, risks, and next actions plainly.
- Default to finishing the full implementation and verification loop in one pass when feasible.
