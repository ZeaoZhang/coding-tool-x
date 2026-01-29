const Ajv = require('ajv');
const semver = require('semver');
const path = require('path');
const fs = require('fs');

/**
 * Validate a plugin manifest against the JSON schema
 * @param {Object} manifest - The manifest object to validate
 * @returns {{ valid: boolean, errors: Array<{field: string, message: string}> }}
 */
function validateManifest(manifest) {
  try {
    // Load the schema
    const schemaPath = path.join(__dirname, 'schema', 'plugin-manifest.json');

    if (!fs.existsSync(schemaPath)) {
      return {
        valid: false,
        errors: [{
          field: 'schema',
          message: `Schema file not found at ${schemaPath}`
        }]
      };
    }

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

    // Initialize AJV with strict mode and formats
    const ajv = new Ajv({
      allErrors: true,
      strict: true,
      validateFormats: false // Disable format validation to avoid unknown format errors
    });

    const validate = ajv.compile(schema);
    const valid = validate(manifest);

    if (!valid) {
      // Transform AJV errors into a more user-friendly format
      const errors = validate.errors.map(err => ({
        field: err.instancePath || err.params?.missingProperty || 'root',
        message: err.message || 'Validation failed',
        details: err
      }));

      return {
        valid: false,
        errors
      };
    }

    return {
      valid: true,
      errors: []
    };

  } catch (error) {
    return {
      valid: false,
      errors: [{
        field: 'validator',
        message: `Validation error: ${error.message}`
      }]
    };
  }
}

/**
 * Check if the plugin's minimum version requirement is compatible with current CTX version
 * @param {string} minVersion - Minimum version required by plugin (e.g., "2.5.0")
 * @returns {{ compatible: boolean, reason: string }}
 */
function checkVersionCompatibility(minVersion) {
  try {
    // Load CTX version from package.json
    const packagePath = path.join(__dirname, '..', '..', 'package.json');

    if (!fs.existsSync(packagePath)) {
      return {
        compatible: false,
        reason: 'Could not find CTX package.json to determine version'
      };
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const currentVersion = packageJson.version;

    // Validate versions are valid semver
    if (!semver.valid(minVersion)) {
      return {
        compatible: false,
        reason: `Invalid minVersion format: "${minVersion}". Must be a valid semantic version (e.g., "2.5.0")`
      };
    }

    if (!semver.valid(currentVersion)) {
      return {
        compatible: false,
        reason: `Invalid CTX version format: "${currentVersion}"`
      };
    }

    // Check if current version satisfies minimum requirement
    const compatible = semver.gte(currentVersion, minVersion);

    if (!compatible) {
      return {
        compatible: false,
        reason: `Plugin requires CTX >= ${minVersion}, but current version is ${currentVersion}`
      };
    }

    return {
      compatible: true,
      reason: `CTX version ${currentVersion} meets minimum requirement ${minVersion}`
    };

  } catch (error) {
    return {
      compatible: false,
      reason: `Version compatibility check failed: ${error.message}`
    };
  }
}

module.exports = {
  validateManifest,
  checkVersionCompatibility
};
