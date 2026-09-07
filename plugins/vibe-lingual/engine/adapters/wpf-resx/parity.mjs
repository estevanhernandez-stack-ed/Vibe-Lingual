// wpf-resx adapter — emitParityTest(): the resx key-parity guard, as C#.
//
// The engine's highest-value guard (recursive key parity across catalogs)
// translated to the WPF world: every Strings.<culture>.resx must carry exactly
// the neutral catalog's key set — missing keys fall back to English silently,
// extra keys are dead weight; both are drift. Emitted as an xUnit test FILE for
// the target repo's own suite (fence-test idiom), not an engine-side check: the
// guard must live where the catalogs live.

export function emitParityTest(locales, options = {}) {
  const resourceClass = options.resourceClass || 'Strings';
  const resxDir = options.resxDir || 'Properties';
  const testNamespace = options.testNamespace || 'App.Tests';
  const appProject = options.appProjectDir || 'src/App';
  const localesLiteral = locales.map((l) => `"${l}"`).join(', ');

  const contents = `using System.Xml.Linq;

namespace ${testNamespace};

/// <summary>
/// Resx key parity across cultures (emitted by vibe-lingual's wpf-resx adapter).
/// A culture catalog missing a key falls back to English SILENTLY; a culture
/// catalog with an extra key is drift nothing reads. Both directions fail here.
/// The test walks up to the repo root the same way the other fence tests do.
/// </summary>
public class ResxParityFenceTests
{
    private static readonly string[] Cultures = { ${localesLiteral} };

    [Fact]
    public void EveryCultureCatalogMatchesTheNeutralKeySet()
    {
        var root = FindRepoRoot();
        Assert.False(root is null, "Could not locate the repo root above the test assembly.");

        var resxDir = Path.Combine(root!, "${appProject.replace(/\//g, '", "')}", "${resxDir}");
        var neutral = Keys(Path.Combine(resxDir, "${resourceClass}.resx"));
        Assert.True(neutral.Count > 0, "The neutral ${resourceClass}.resx has no keys — nothing to guard.");

        foreach (var culture in Cultures)
        {
            var path = Path.Combine(resxDir, $"${resourceClass}.{culture}.resx");
            Assert.True(File.Exists(path), $"Missing culture catalog: {path}");
            var keys = Keys(path);

            var missing = neutral.Except(keys).OrderBy(k => k).ToList();
            var extra = keys.Except(neutral).OrderBy(k => k).ToList();
            Assert.True(missing.Count == 0 && extra.Count == 0,
                $"{culture}: {missing.Count} missing ({string.Join(", ", missing.Take(5))}), "
                + $"{extra.Count} extra ({string.Join(", ", extra.Take(5))}).");
        }
    }

    private static HashSet<string> Keys(string path) =>
        XDocument.Load(path).Root!
            .Elements("data")
            .Select(d => (string?)d.Attribute("name"))
            .Where(n => !string.IsNullOrEmpty(n))
            .Select(n => n!)
            .ToHashSet(StringComparer.Ordinal);

    private static string? FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (dir.EnumerateFiles("*.sln*").Any()) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }
}
`;

  return { path: `${options.testProjectDir || 'tests'}/ResxParityFenceTests.cs`, contents };
}

export default emitParityTest;
