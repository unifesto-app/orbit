// Galaxy's tabs: Galaxy (the dashboard), Queues, Find and Money, each shown only with its staff feature (Roles doc, owner
// 16 Nov 2026). Re-tapping Galaxy opens the mode sheet, the way back to Home (src/modeKit.tsx). There's no staff web
// site any more ("remove staff website, company board and all").
// ponytail: the Platform tab (legal documents, app settings, staff and the audit log) comes with its screens.
import { NativeTabs } from 'expo-router/native-tabs';
import { Platform } from 'react-native';

import { TAB_BAR, retap } from '../../../modeKit';
import { hasFeature } from '../../../modes';
import { useMe } from '../../../session';

const ios = Platform.OS === 'ios';

export default function GalaxyTabs() {
  const me = useMe();
  return (
    <NativeTabs {...TAB_BAR}>
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets={ios} disableScrollToTop listeners={retap('galaxy')}>
        <NativeTabs.Trigger.Icon src={require('../../../../assets/tabs/galaxy.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Galaxy</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="queues" disableAutomaticContentInsets={ios} hidden={!hasFeature(me, 'queues')}>
        <NativeTabs.Trigger.Icon src={require('../../../../assets/tabs/queues.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Queues</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="find" disableAutomaticContentInsets={ios} hidden={!hasFeature(me, 'people') && !hasFeature(me, 'hosts')}>
        <NativeTabs.Trigger.Icon src={require('../../../../assets/tabs/search.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Find</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="money" disableAutomaticContentInsets={ios} hidden={!hasFeature(me, 'money')}>
        <NativeTabs.Trigger.Icon src={require('../../../../assets/tabs/money.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Money</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
