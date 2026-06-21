// Deliberately malformed / unparseable for the matcher's static extractor:
// no globalIgnores call at all, plus a syntactically broken body. The matcher
// must NOT crash — it falls back to the built-in default exclude list.
this is not valid javascript {{{ globalIgnore( "legacy
