# Builds "Sample Quest Notes.docx" from a simple outline, with real Word heading
# and list styles, so the journal can be tested without authoring a doc by hand.
param(
    [string]$OutFile = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Sample Quest Notes.docx')
)

$outline = @(
    @{ s = 'Heading1'; t = 'Before the Storm' }
    @{ s = 'Normal';   t = 'Type: Main' }
    @{ s = 'Normal';   t = 'Level: 4' }
    @{ s = 'Normal';   t = 'Giver: Jarl Balgruuf' }
    @{ s = 'Normal';   t = 'Location: Dragonsreach, Whiterun' }
    @{ s = 'Normal';   t = 'Word of the dragon attack at Helgen must reach the Jarl before the hold is caught unaware.' }
    @{ s = 'Heading2'; t = 'Reach Whiterun' }
    @{ s = 'ListParagraph'; t = '[x] Travel the road north from Riverwood @Whiterun' }
    @{ s = 'ListParagraph'; t = '[x] Speak with the guards at the gate #diplomacy' }
    @{ s = 'Heading2'; t = 'Deliver the warning' }
    @{ s = 'ListParagraph'; t = 'Inform Jarl Balgruuf of the dragon attack' }
    @{ s = 'ListParagraph'; t = 'Agree to help the court wizard (optional)' }
    @{ s = 'Normal';   t = 'Reward: Favour of the Jarl, access to Dragonsreach' }

    @{ s = 'Heading1'; t = 'Bleak Falls Barrow' }
    @{ s = 'Normal';   t = 'Type: Main' }
    @{ s = 'Normal';   t = 'Level: 6' }
    @{ s = 'Normal';   t = 'Giver: Farengar Secret-Fire' }
    @{ s = 'Normal';   t = 'Requires: Before the Storm' }
    @{ s = 'Normal';   t = 'Retrieve the Dragonstone, a map of ancient dragon burial sites.' }
    @{ s = 'Heading2'; t = 'Enter the barrow' }
    @{ s = 'ListParagraph'; t = '[x] Climb the mountain path above Riverwood @Riverwood' }
    @{ s = 'ListParagraph'; t = 'Clear the bandit camp at the entrance #combat' }
    @{ s = 'Heading2'; t = 'The inner sanctum' }
    @{ s = 'ListParagraph'; t = 'Solve the pillar puzzle' }
    @{ s = 'ListParagraph'; t = 'Defeat the draugr overlord' }
    @{ s = 'ListParagraph'; t = 'Recover the Dragonstone' }
    @{ s = 'ListParagraph'; t = 'Search the side chamber for loot (optional)' }
    @{ s = 'Normal';   t = 'Reward: Dragonstone, 400 gold' }

    @{ s = 'Heading1'; t = "Thieves' Cache" }
    @{ s = 'Normal';   t = 'Type: Faction' }
    @{ s = 'Normal';   t = 'Giver: Brynjolf' }
    @{ s = 'Normal';   t = 'Location: Riften' }
    @{ s = 'Heading2'; t = 'The job' }
    @{ s = 'ListParagraph'; t = 'Plant the ring on Brand-Shei #stealth' }
    @{ s = 'ListParagraph'; t = 'Escape without being seen (optional)' }
    @{ s = 'Normal';   t = 'Reward: 100 gold, Guild contact' }

    @{ s = 'Heading1'; t = 'Gather Alchemy Reagents' }
    @{ s = 'Normal';   t = 'Type: Misc' }
    @{ s = 'ListParagraph'; t = 'Collect 5 mountain flowers #gathering' }
    @{ s = 'ListParagraph'; t = 'Collect 3 blue butterfly wings' }
    @{ s = 'ListParagraph'; t = '[x] Buy an empty mortar @Windhelm' }
)

function Get-Paragraph($style, $text) {
    $escaped = [System.Security.SecurityElement]::Escape($text)
    $numPr = if ($style -eq 'ListParagraph') { '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' } else { '' }
    "<w:p><w:pPr><w:pStyle w:val=`"$style`"/>$numPr</w:pPr><w:r><w:t xml:space=`"preserve`">$escaped</w:t></w:r></w:p>"
}

$body = ($outline | ForEach-Object { Get-Paragraph $_.s $_.t }) -join ''

$documentXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>$body<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>
</w:document>
"@

$contentTypes = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>
"@

$rels = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"@

$docRels = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>
"@

$styleDefs = @(
    @{ id = 'Normal';        name = 'Normal';         outline = $null }
    @{ id = 'Heading1';      name = 'heading 1';      outline = 0 }
    @{ id = 'Heading2';      name = 'heading 2';      outline = 1 }
    @{ id = 'ListParagraph'; name = 'List Paragraph'; outline = $null }
)
$styleXml = ($styleDefs | ForEach-Object {
    $pPr = if ($null -ne $_.outline) { "<w:pPr><w:outlineLvl w:val=`"$($_.outline)`"/></w:pPr>" } else { '' }
    $sz = if ($_.id -eq 'Heading1') { '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' }
          elseif ($_.id -eq 'Heading2') { '<w:rPr><w:b/><w:sz w:val="26"/></w:rPr>' } else { '' }
    "<w:style w:type=`"paragraph`" w:styleId=`"$($_.id)`"><w:name w:val=`"$($_.name)`"/>$pPr$sz</w:style>"
}) -join ''

$stylesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">$styleXml</w:styles>
"@

$numberingXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>
"@

$parts = [ordered]@{
    '[Content_Types].xml'           = $contentTypes
    '_rels/.rels'                   = $rels
    'word/document.xml'             = $documentXml
    'word/styles.xml'               = $stylesXml
    'word/numbering.xml'            = $numberingXml
    'word/_rels/document.xml.rels'  = $docRels
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $OutFile) { Remove-Item $OutFile -Force }

# Entry names are written explicitly with forward slashes; ZipFile::CreateFromDirectory
# on .NET Framework emits backslashes, which some readers reject.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$stream = [IO.File]::Open($OutFile, [IO.FileMode]::CreateNew)
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
foreach ($name in $parts.Keys) {
    $entry = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = New-Object System.IO.StreamWriter($entry.Open(), $utf8)
    $writer.Write($parts[$name])
    $writer.Dispose()
}
$zip.Dispose()
$stream.Dispose()

Write-Host "Created $OutFile"
