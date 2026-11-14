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
// adds it and in whatever order plugins run.
const TAG = '# orbit-always-run-scripts';
const ANCHOR = '  post_install do |installer|';
const BLOCK = [
  `  ${TAG}`,
  '  post_integrate do |installer|',
  '    installer.aggregate_targets.map(&:user_project).uniq.each do |project|',
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

module.exports = function withAlwaysRunScripts(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      if (contents.includes(TAG)) return cfg;
      if (!contents.includes(ANCHOR)) throw new Error(`withAlwaysRunScripts: no "${ANCHOR.trim()}" in ${podfile}`);
      fs.writeFileSync(podfile, contents.replace(ANCHOR, `${BLOCK}${ANCHOR}`));
      return cfg;
    },
  ]);
};
