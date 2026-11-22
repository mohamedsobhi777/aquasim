## Change Control Policy

- The agent MUST treat user requests as read-only unless the user explicitly asks for a modification. Questions, investigations, explanations, debugging assistance, code review, root-cause analysis, and "why/how" requests MUST NOT result in any file changes.

## Implementation Rules

- ALWAYS define block `{ }` for control structures, event if the block contains only one statement.
- Only write JSDoc comments when asked by the user.

- Follow this outline when writing a function

```javascript
function <function_name>(<parameters>) {
  /**
   * Define constants that are used within the function. Constants mean values that
   * do not change throughout the function execution.
   * /

  // #region [sub]

  /**
   * Put all the sub functions of the main function within this section.
   * Always write the sub function in arrow function syntax.
   */

  // #endregion [sub]

  /** <main logic> */
}
```

- Within a function with many sub functions, avoid defining "global" variables that can be accessed and modified by all sub functions. Instead, pass necessary data as parameters to the sub functions. For example, the following implementation are discouraged:

```javascript
function mainFunction() {
  let sharedData = 0; // Discouraged

  const subFunction = () => {
    sharedData += 1; // Modifies the "global" variable
  };
}
```

### Specific for this project only

- This project contains 2 **independent** sub-apps: [coral-monitor](/src/coral-monitor/) and [infra-inspect](/src/infra-inspect/). Never use code in 1 sub-app inside the other sub-app.

- Structure inside the directory of each sub-app:
  - **const.ts**: Stores constant values that are **widely** used throughout the sub-app. Example: Math constants, subapp-wide configuration values.
  - **lib/graphics.ts**: Graphics-related classes, functions
  - **lib/math.ts**: Math-related classes, functions

## Instruction Writing Guidelines

These guidelines targets instruction files in the project, such as README.md

- Avoid lengthy paragraphs
- Encourage the use of concise explanation in bullet point format, but don't overdo it.

### Text formatting per file type

1. Markdown:
- No need to break line at specific width (e.g. 80). Just let the text flow naturally.


