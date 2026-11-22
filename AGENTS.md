## Change Control Policy

- The agent MUST treat user requests as read-only unless the user explicitly asks for a modification. Questions, investigations, explanations, debugging assistance, code review, root-cause analysis, and "why/how" requests MUST NOT result in any file changes.

## Implementation Rules

n/a

### Specific for this project only

- This project contains 2 **independent** sub-apps: [coral-monitor](/src/coral-monitor/) and [infra-inspect](/src/infra-inspect/). Never use code in 1 sub-app inside the other sub-app.

- Inside the directory of each sub-app, there's a `const.ts` file which stores all constant values that are **widely** used throughout the sub-app. Example of such constants: Math constants, subapp-wide configuration values.


## Instruction Writing Guidelines

These guidelines targets instruction files in the project, such as README.md

- Avoid lengthy paragraphs
- Encourage the use of concise explanation in bullet point format, but don't overdo it.

### Text formatting per file type

1. Markdown:
- No need to break line at specific width (e.g. 80). Just let the text flow naturally.


