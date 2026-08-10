#nullable enable
#load "version.cake"

var target = Argument("target", "Sonar");
var productName = Argument("product_name", EnvironmentVariable("PRODUCT_NAME") ?? "");
var version = Argument("package_version", EnvironmentVariable("PACKAGE_VERSION") ?? "");
var sonarToken = Argument("sonar_token", EnvironmentVariable("SONAR_TOKEN") ?? "");
const string SonarHostUrl = "https://sonarcloud.io";
const string SonarOrganization = "defra";
const string SonarScannerVersion = "5.0.0";

Task("Version")
    .Does(() =>
    {
        if (string.IsNullOrWhiteSpace(version))
        {
            version = CalculateVersion();
        }

        Information($"Version: {version}");
    });

Task("Install")
    .IsDependentOn("Version")
    .Description("Installs dependencies from package-lock.json")
    .Does(() => RunNpm("ci"));

Task("Test")
    .IsDependentOn("Install")
    .Description("Runs Node tests before analysis")
    .Does(() => RunNode("--test"));

Task("Sonar")
    .IsDependentOn("Test")
    .Description("Runs SonarCloud analysis for JavaScript sources")
    .Does(() =>
    {
        if (string.IsNullOrWhiteSpace(sonarToken))
        {
            throw new Exception("SonarCloud token is required to run analysis.");
        }

        if (string.IsNullOrWhiteSpace(productName))
        {
            throw new Exception("A SonarCloud product/project name is required.");
        }

        RunNpx(
            $"--yes @sonar/scan@{SonarScannerVersion} " +
            $"-Dsonar.projectKey=\"{productName}\" " +
            $"-Dsonar.organization=\"{SonarOrganization}\" " +
            $"-Dsonar.host.url=\"{SonarHostUrl}\" " +
            $"-Dsonar.token=\"{sonarToken}\" " +
            $"-Dsonar.projectVersion=\"{version}\" " +
            "-Dsonar.sources=\"src\" " +
            "-Dsonar.exclusions=\"changelog/**,.github/**,artifacts/**,.cake/**\"");
    });

Task("Default")
    .IsDependentOn("Sonar");

RunTarget(target);
