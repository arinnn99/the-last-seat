const app = require('./main');

app.start().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
