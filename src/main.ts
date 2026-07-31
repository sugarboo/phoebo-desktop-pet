import { bootstrapDesktopShell } from "./app/bootstrap";

// `void` deliberately starts the async bootstrap without leaving a floating
// Promise warning. Startup owns and reports its errors internally.
void bootstrapDesktopShell();
