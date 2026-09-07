// wpf-resx adapter — emitGuard(): the extracted-file literal ratchet, as C#.
//
// The next-intl adapter's guard is an ESLint jsx-no-literals override per fully-
// extracted file. WPF has no ESLint; the native equivalent is a source-reading
// fence test (the target-repo idiom this adapter leans into): for every file on
// the extracted list, scanning its display attributes must find ZERO literal
// values — everything is a markup extension ({x:Static …}) or gone. Ratchet by
// adding files to the list in the same commit that extracts them.

export function emitGuard(files, options = {}) {
  const testNamespace = options.testNamespace || 'App.Tests';
  const filesLiteral = files.map((f) => `        "${f}",`).join('\n');

  const contents = `using System.Text.RegularExpressions;

namespace ${testNamespace};

/// <summary>
/// Display-literal ratchet for extracted XAML (emitted by vibe-lingual's
/// wpf-resx adapter). A file on this list is FULLY extracted: its display
/// attributes (Text/Content/Header/Title/Caption/Description/ToolTip/
/// PlaceholderText/Watermark/AutomationProperties.*) hold markup extensions,
/// never literal copy. Add a file here in the same commit that extracts it —
/// the list only grows.
/// </summary>
public class XamlDisplayLiteralFenceTests
{
    private static readonly string[] ExtractedFiles =
    {
${filesLiteral}
    };

    private static readonly Regex DisplayAttrLiteral = new(
        "\\\\b(Text|Content|Header|Title|Caption|Description|ToolTip|PlaceholderText|Watermark|AutomationProperties\\\\.(?:Name|HelpText))\\\\s*=\\\\s*\\"(?!\\\\{)[^\\"]*[A-Za-z]{2}[^\\"]*\\"",
        RegexOptions.Compiled);

    [Fact]
    public void ExtractedFilesCarryNoDisplayLiterals()
    {
        var root = FindRepoRoot();
        Assert.False(root is null, "Could not locate the repo root above the test assembly.");

        var offenders = new List<string>();
        foreach (var rel in ExtractedFiles)
        {
            var path = Path.Combine(root!, rel.Replace('/', Path.DirectorySeparatorChar));
            Assert.True(File.Exists(path), $"Extracted file missing: {rel}");
            foreach (var line in File.ReadAllLines(path).Select((text, i) => (text, i)))
            {
                if (DisplayAttrLiteral.IsMatch(line.text))
                {
                    offenders.Add($"{rel}:{line.i + 1}");
                }
            }
        }

        Assert.True(offenders.Count == 0,
            "Display literals in extracted XAML (copy belongs in the resx catalog): "
            + string.Join(", ", offenders));
    }

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

  return { path: `${options.testProjectDir || 'tests'}/XamlDisplayLiteralFenceTests.cs`, contents };
}

export default emitGuard;
