#nullable enable
#load "version.cake"

var target = Argument("target", "Default");
var packOutputDir = Argument("output_dir", EnvironmentVariable("OUTPUT_DIR") ?? "artifacts");
var version = Argument("package_version", EnvironmentVariable("PACKAGE_VERSION") ?? "");
var stagingDir = "./.cake/package";

Action createPackage = () =>
{
    EnsureDirectoryExists(stagingDir);
    EnsureDirectoryExists(packOutputDir);

    CopyFileToDirectory("./package.json", stagingDir);
    CopyFileToDirectory("./package-lock.json", stagingDir);
    if (FileExists("./README.md"))
    {
        CopyFileToDirectory("./README.md", stagingDir);
    }

    CopyDirectory("./src", $"{stagingDir}/src");

    RunNpm(
        $"version {version} --allow-same-version --no-git-tag-version " +
        $"--ignore-scripts --prefix \"{stagingDir}\"");
    RunNpm($"pack \"{stagingDir}\" --pack-destination \"{MakeAbsolute(Directory(packOutputDir))}\"");
};

Task("Clean")
    .Description("Removes generated Node package output")
    .Does(() =>
    {
        CleanDirectory(packOutputDir);
        CleanDirectory(stagingDir);
    });

Task("Version")
    .IsDependentOn("Clean")
    .Description("Calculates the npm package version")
    .Does(() =>
    {
        if (string.IsNullOrWhiteSpace(version))
        {
            version = CalculateVersion();
        }

        Information($"Version {version}");
    });

Task("Install")
    .IsDependentOn("Version")
    .Description("Installs dependencies from package-lock.json")
    .Does(() => RunNpm("ci"));

Task("SecurityAudit")
    .IsDependentOn("Install")
    .Description("Audits dependencies")
    .Does(() => RunNpm("run security-audit"));

Task("Format")
    .IsDependentOn("SecurityAudit")
    .Description("Checks formatting without changing source files")
    .Does(() => RunNpm("run format:check"));

Task("Lint")
    .IsDependentOn("Format")
    .Description("Runs JavaScript linting")
    .Does(() => RunNpm("run lint"));

Task("Test")
    .IsDependentOn("Lint")
    .Description("Runs the Vitest test suite")
    .Does(() => RunNpm("test"));

Task("Build")
    .IsDependentOn("Test")
    .Description("Validates the syntax of package source files")
    .Does(() =>
    {
        foreach (var sourceFile in GetFiles("./src/**/*.js"))
        {
            RunNode($"--check \"{sourceFile}\"");
        }
    });

Task("Pack")
    .IsDependentOn("Build")
    .Description("Validates and creates a versioned npm package archive")
    .Does(createPackage);

Task("PackOnly")
    .IsDependentOn("Version")
    .Description("Creates a versioned npm package archive from previously validated source")
    .Does(createPackage);

Task("Default")
    .IsDependentOn("Pack");

RunTarget(target);
