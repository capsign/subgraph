const fs = require('fs');

// Read the ABIs
const offeringDiamond = JSON.parse(fs.readFileSync('./abis/OfferingDiamond.json', 'utf8'));
const complianceAdmin = JSON.parse(fs.readFileSync('./abis/ComplianceAdminFacet.json', 'utf8'));
const offeringCompliance = JSON.parse(fs.readFileSync('./abis/OfferingComplianceFacet.json', 'utf8'));

// Filter out old events from OfferingDiamond
const filtered = offeringDiamond.filter(item => {
  if (item.type === 'event') {
    // Remove old compliance events
    const oldEvents = ['ClassificationUpdated', 'ClassificationRevoked', 'ComplianceInitialized', 'ComplianceConfigUpdated'];
    return !oldEvents.includes(item.name);
  }
  return true;
});

// Add new events from ComplianceAdminFacet
const newAdminEventNames = ['ClassificationAdded', 'ClassificationRevoked', 'JurisdictionSet', 'SanctionStatusSet', 'WhitelistStatusSet', 'TrustedKYCProviderAdded', 'TrustedKYCProviderRemoved'];
const newAdminEvents = complianceAdmin.filter(item => 
  item.type === 'event' && newAdminEventNames.includes(item.name)
);

// Add ComplianceInitialized with correct signature from OfferingComplianceFacet
const complianceInitialized = offeringCompliance.find(item => 
  item.type === 'event' && item.name === 'ComplianceInitialized'
);

const merged = [...filtered, ...newAdminEvents];
if (complianceInitialized) {
  merged.push(complianceInitialized);
}

// Write the merged ABI
fs.writeFileSync('./abis/OfferingDiamond.json', JSON.stringify(merged, null, 2));
console.log('Successfully merged ABIs');
