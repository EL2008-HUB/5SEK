const { bootstrapEnv } = require("../src/config/bootstrapEnv");
bootstrapEnv(require("path").join(__dirname, ".."));

const { validateRuntimeEnv } = require("../src/config/validateRuntimeEnv");

validateRuntimeEnv({ exitOnFailure: true });
