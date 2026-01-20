const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

// Mock config
const config = {
    projectsDir: path.join(process.env.HOME || process.cwd(), 'workspace'), // Adjust this to match your actual workspace
    // Add other config needs if necessary
};

// Try to load actual config if possible, otherwise use mock
try {
    const { loadConfig } = require('../src/config/loader');
    Object.assign(config, loadConfig());
    console.log('Loaded actual config');
} catch (e) {
    console.log('Using mock config (loader not found or failed): ' + e.message);
}

const { getProjectsWithStats, getSessionsForProject } = require('../src/server/services/sessions');

async function runTests() {
    console.log('Starting Performance Tests...\n');

    // Warmup (to trigger require caching etc)
    console.log('Warmup...');
    try {
        await getProjectsWithStats(config);
    } catch (e) {
        console.error('Warmup failed:', e.message);
    }

    // Test 1: getProjectsWithStats
    console.log('\n----------------------------------------');
    console.log('Test 1: getProjectsWithStats (Scanning all projects)');
    const start1 = performance.now();
    const projects = await getProjectsWithStats(config, { force: true }); // Force to bypass cache for test
    const end1 = performance.now();
    console.log(`Found ${projects.length} projects`);
    console.log(`Time: ${(end1 - start1).toFixed(2)}ms`);

    if (projects.length > 0) {
        // Pick a project with sessions
        const projectWithSessions = projects.find(p => p.sessionCount > 0) || projects[0];
        const projectName = projectWithSessions.name;

        // Test 2: getSessionsForProject
        console.log('\n----------------------------------------');
        console.log(`Test 2: getSessionsForProject (Project: ${projectName})`);
        const start2 = performance.now();
        const result = await getSessionsForProject(config, projectName);
        const end2 = performance.now();
        console.log(`Found ${result.sessions.length} sessions`);
        console.log(`Time: ${(end2 - start2).toFixed(2)}ms`);

        // Test 3: Cached access
        console.log('\n----------------------------------------');
        console.log('Test 3: Cached Access (Second call)');
        const start3 = performance.now();
        await getProjectsWithStats(config); // Should hit cache
        const end3 = performance.now();
        console.log(`getProjectsWithStats (Cached) Time: ${(end3 - start3).toFixed(2)}ms`);
    } else {
        console.log('No projects found to test sessions.');
    }
}

runTests().catch(console.error);
