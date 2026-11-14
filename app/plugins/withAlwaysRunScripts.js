const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

// Marks output-less Run Script phases "always run", which silences Xcode's
// "Script has ambiguous dependencies causing it to run on every build".
// Ported from Unifesto mobile/plugins/withAlwaysRunScripts.js.
//
// A phase with no outputs already runs on every build; Xcode only warns until that is explicit
// (alwaysOutOfDate = 1, i.e. "Based on dependency analysis" unchecked), so this changes no
// behaviour. Today only Expo Dev Launcher's "Strip Local Network Keys for Release" trips it.
// Doing it in the Podfile's post_integrate catches every such phase, whichever plugin or pod
// adds it and in whatever order plugins run. CocoaPods allows one post_integrate per Podfile, so
// if another plugin ever adds its own, `pod install` fails loudly and the two need merging.
const TAG = '# orbit-always-run-scripts';
const ANCHOR = '  post_install do |installer|';
const BLOCK = [
  `  ${TAG}`,
  '  post_integrate do |installer|',
  '    installer.aggregate_targets.map(&:user_project).compact.uniq.each do |project|',
  '      phases = project.targets.flat_map(&:shell_script_build_phases).select do |p|',
  "        p.always_out_of_date != '1' && Array(p.output_paths).empty? && Array(p.output_file_list_paths).empty?",
  '      end',
  '      next if phases.empty?',
  "      phases.each { |p| p.always_out_of_date = '1' }",
  '      project.save',
  '    end',
  '  end',
  '',
].join('\n');
// A block this plugin wrote, any version: from the tag line to the first `end` back at two spaces,
// which closes post_integrate (the inner `end`s are indented further).
const OUR_BLOCK = /^ {2}# orbit-always-run-scripts[^\n]*\n[\s\S]*?^ {2}end\n/m;

/**
 * The Podfile with this plugin's block just before `post_install`. Running it again changes
 * nothing; a block from an older version of this file is replaced, so edits here take effect on
 * the next prebuild without --clean. Throws if the Podfile has no `post_install` to anchor on.
 */
function addAlwaysRunBlock(podfile) {
  if (podfile.includes(BLOCK)) return podfile;
  const without = podfile.replace(OUR_BLOCK, '');
  if (!without.includes(ANCHOR)) throw new Error(`withAlwaysRunScripts: no "${ANCHOR.trim()}" in the Podfile`);
  return without.replace(ANCHOR, `${BLOCK}${ANCHOR}`);
}

function withAlwaysRunScripts(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      const next = addAlwaysRunBlock(contents);
      if (next !== contents) fs.writeFileSync(podfile, next);
      return cfg;
    },
  ]);
}

module.exports = withAlwaysRunScripts;
module.exports.addAlwaysRunBlock = addAlwaysRunBlock;
