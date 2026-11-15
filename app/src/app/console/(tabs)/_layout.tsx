// Console's tabs: Console (the host's day, waiting work and events), Money and Host. Re-tapping Console opens the mode
// sheet, the way back to Home (src/modeKit.tsx). Native tabs can't sit inside Home's, so each mode has its own bar.
import { NativeTabs } from 'expo-router/native-tabs';
import { Platform } from 'react-native';

import { TAB_BAR, retap } from '../../../modeKit';

const ios = Platform.OS === 'ios';

export default function ConsoleTabs() {
  return (
    <NativeTabs {...TAB_BAR}>
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets={ios} disableScrollToTop listeners={retap('console')}>
        <NativeTabs.Trigger.Icon src={require('../../../../assets/tabs/console.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Console</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="money" disableAutomaticContentInsets={ios}>
        <NativeTabs.Trigger.Icon src={require('../../../../assets/tabs/money.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Money</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="host" disableAutomaticContentInsets={ios}>
        <NativeTabs.Trigger.Icon src={require('../../../../assets/tabs/team.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Host</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
