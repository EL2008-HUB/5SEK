const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const target = process.env.SMOKE_HEALTHCHECK_URL || "http://127.0.0.1:3000/health";

fetch(target)
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Smoke check failed with status ${response.status}`);
    }
    return response.json();
  })
  .then((payload) => {
    console.log(JSON.stringify(payload, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
