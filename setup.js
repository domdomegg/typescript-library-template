#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function exec(command) {
	try {
		return execSync(command, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit']});
	} catch (error) {
		console.error(`❌ Failed to run: ${command}`, error);
		throw error;
	}
}

function safeExec(command, description) {
	try {
		console.log(`⏳ ${description}...`);
		exec(command);
		console.log(`✅ ${description} complete`);
		return true;
	} catch (error) {
		console.warn(`⚠️  ${description} failed - you may need to do this manually`, error);
		return false;
	}
}

function configureNpmToken(isPrivate) {
	if (!isPrivate) {
		console.log('⏳ Fetching NPM token from secrets repository...');
		const npmToken = exec('gh api repos/domdomegg/secrets/contents/npm.txt --jq .content | base64 -d').trim();
		exec(`gh secret set NPM_TOKEN --body "${npmToken}"`);
		console.log('✅ NPM_TOKEN secret configured');
	}
}

function updatePackageJson(packageName, repoUrl, isPrivate) {
	const packageJsonPath = path.join(__dirname, 'package.json');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

	packageJson.name = packageName;
	packageJson.description = 'TODO: A short description of what the library does and why people might want to use it.';
	packageJson.repository.url = repoUrl;

	if (isPrivate) {
		packageJson.private = true;
	}

	fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
	console.log('✅ Updated package.json');
}

function enableGitHubActionsPermissions() {
	safeExec('gh repo edit --enable-issues --enable-wiki=false --enable-projects=false', 'Configuring repository settings');
	safeExec('gh api repos/:owner/:repo/actions/permissions/fork-pr-contributor-approval -X PUT --input - << \'EOF\'\n{"approval_policy":"first_time_contributors_new_to_github"}\nEOF', 'Enabling first-time contributors to trigger GitHub Actions');
	safeExec('gh api repos/:owner/:repo/actions/permissions/workflow -X PUT --input - << \'EOF\'\n{"can_approve_pull_request_reviews":true}\nEOF', 'Allowing GitHub Actions to create and approve pull requests');
}

function setupBranchProtection() {
	safeExec(`gh api repos/:owner/:repo/branches/master/protection -X PUT --input - << 'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["ci lts/*", "ci (current)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": true
}
EOF`, 'Setting up branch protection');
}

function addToFileSyncAutomation(repoUrl) {
	console.log('⏳ Adding repository to file sync automation...');
	const syncConfigUrl = 'repos/domdomegg/domdomegg/contents/.github/workflows/repo-file-sync.yaml';
	const syncConfig = exec(`gh api ${syncConfigUrl} --jq .content | base64 -d`);

	const repoMatch = repoUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
	const [, owner, repo] = repoMatch;
	const newRepoEntry = `            ${owner}/${repo}`;

	if (!syncConfig.includes(newRepoEntry.trim())) {
		let updatedConfig = syncConfig;

		// Add to Dependabot automation section
		updatedConfig = updatedConfig.replace(
			/(- name: Dependabot automation[\s\S]*?REPOSITORIES: \|[\s\S]*?)( {12}domdomegg\/typescript-library-template)/,
			`$1$2\n${newRepoEntry}`,
		);

		// Add to Node.js general template section
		updatedConfig = updatedConfig.replace(
			/(- name: Node\.js general template[\s\S]*?REPOSITORIES: \|[\s\S]*?)( {12}domdomegg\/typescript-library-template)/,
			`$1$2\n${newRepoEntry}`,
		);

		const currentSha = exec(`gh api ${syncConfigUrl} --jq .sha`).trim();

		const updatePayload = {
			message: `Add ${owner}/${repo} to file sync automation`,
			content: Buffer.from(updatedConfig).toString('base64'),
			sha: currentSha,
		};

		exec(`gh api ${syncConfigUrl} -X PUT --input - << 'EOF'
${JSON.stringify(updatePayload)}
EOF`);
		console.log('✅ Added to file sync automation');
	} else {
		console.log('ℹ️  Repository already in file sync automation');
	}
}

function updateReadme(packageName, isPrivate) {
	const readmeContent = `# ${packageName}

TODO: A short description of what the library does and why people might want to use it.

## Usage

TODO: Add usage instructions

## Contributing

Pull requests are welcomed on GitHub! To get started:

1. Install Git and Node.js
2. Clone the repository
3. Install dependencies with \`npm install\`
4. Run \`npm run test\` to run tests
5. Build with \`npm run build\`${isPrivate
	? ''
	: `

## Releases

Versions follow the [semantic versioning spec](https://semver.org/).

To release:

1. Use \`npm version <major | minor | patch>\` to bump the version
2. Run \`git push --follow-tags\` to push with tags
3. Wait for GitHub Actions to publish to the NPM registry.
`}`;

	fs.writeFileSync(path.join(__dirname, 'README.md'), readmeContent);
	console.log('✅ Updated README.md');
}

function deleteSetupJs() {
	fs.unlinkSync(__filename);
	console.log('✅ Deleted setup.js');
}

async function main() {
	console.log('🚀 Setting up your TypeScript library...\n');

	// Check git and gh CLI is available
	exec('git --version');
	exec('gh api user');

	// Get current repo info
	const remoteUrl = exec('git remote get-url origin').trim();
	const repoUrl = remoteUrl;
	const match = remoteUrl.match(/([^/]+)\.git$/);
	const packageName = match?.[1];
	if (!match || !packageName) {
		throw new Error('Could not extract package name from git remote');
	}

	const isPrivate = process.argv.includes('--private');

	configureNpmToken(isPrivate);
	updatePackageJson(packageName, repoUrl, isPrivate);
	enableGitHubActionsPermissions();
	setupBranchProtection();
	addToFileSyncAutomation(repoUrl);
	updateReadme(packageName, isPrivate);
	deleteSetupJs();
}

main().catch(console.error);
