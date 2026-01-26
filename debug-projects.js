
const workspaceService = require('./src/server/services/workspace-service.js');
const sessionsService = require('./src/server/services/sessions.js');
const { PATHS } = require('./src/config/paths.js');

async function test() {
    console.log('Testing getAllAvailableProjects...');
    try {
        const projects = await workspaceService.getAllAvailableProjects();
        console.log('Projects found:', projects.length);
    } catch (error) {
        console.error('Error in getAllAvailableProjects:', error);
    }

    console.log('Testing getProjectsWithStats directly...');
    try {
        // We can try to use one of the channels from workspace-service
        // { name: 'claude', projectsDir: NATIVE_PATHS.claude.projects }
        const { NATIVE_PATHS } = require('./src/config/paths.js');

        // Create a mock channel if NATIVE_PATHS is not fully populated or just use what we have
        // Assuming NATIVE_PATHS structure based on code reading

        const channels = [
            { name: 'claude', projectsDir: NATIVE_PATHS?.claude?.projects },
            { name: 'codex', projectsDir: NATIVE_PATHS?.codex?.sessions },
            { name: 'gemini', projectsDir: NATIVE_PATHS?.gemini?.tmp }
        ];

        for (const channel of channels) {
            if (!channel.projectsDir) {
                console.log(`Skipping channel ${channel.name}: projectsDir undefined`);
                continue;
            }
            console.log(`Testing channel: ${channel.name} at ${channel.projectsDir}`);
            const config = { projectsDir: channel.projectsDir };
            const result = await sessionsService.getProjectsWithStats(config, { force: true });
            console.log(`Result type: ${typeof result}`);
            console.log(`Is Array: ${Array.isArray(result)}`);

            // Check if iterable
            try {
                for (const x of result) { }
                console.log('Result is iterable');
            } catch (e) {
                console.error('Result is NOT iterable:', e.message);
            }

            if (Array.isArray(result)) {
                console.log(`Count: ${result.length}`);
                if (result.length > 0) {
                    console.log('First item:', result[0]);
                }
            } else {
                console.log('Result:', result);
            }
        }

    } catch (error) {
        console.error('Error in direct test:', error);
    }
}

test();
