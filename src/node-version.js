// Imported first by server.js, before any other module runs.
//
// An old Node version does not fail at install time. npm prints one yellow
// EBADENGINE line that scrolls past, the server starts and says it is
// listening, and only the first check fails, with a raw ReferenceError about
// fetch that says nothing about versions. This turns that into a sentence
// telling the reader what to do.
const REQUIRED_MAJOR = 20;

const current = process.versions.node;
const major = Number.parseInt(current, 10);

if (Number.isInteger(major) && major < REQUIRED_MAJOR) {
  console.error(
    `This project needs Node.js ${REQUIRED_MAJOR} or newer, and this is Node v${current}.\n` +
      "\n" +
      "Nothing will work until Node is updated. The YouTube and Discord calls use\n" +
      "fetch, which Node only gained in version 18.\n" +
      "\n" +
      'Section 1 of the readme, under "If Node is already installed but too old",\n' +
      "has the update command for your system.",
  );
  process.exit(1);
}
