export const getStripeCountryCode = (countryName?: string): string => {
    if (!countryName) return 'NL';
    const trimmed = countryName.trim();
    if (!trimmed) return 'NL';
    if (trimmed.length === 2) return trimmed.toUpperCase();

    const upper = trimmed.toUpperCase();
    const countryMap: Record<string, string> = {
        'NETHERLANDS': 'NL',
        'THE NETHERLANDS': 'NL',
        'HOLLAND': 'NL',
        'NEDERLAND': 'NL',
        'IRELAND': 'IE',
        'GERMANY': 'DE',
        'DEUTSCHLAND': 'DE',
        'FRANCE': 'FR',
        'BELGIUM': 'BE',
        'SPAIN': 'ES',
        'ITALY': 'IT',
        'PORTUGAL': 'PT',
        'AUSTRIA': 'AT',
        'SWITZERLAND': 'CH',
        'UNITED KINGDOM': 'GB',
        'GREAT BRITAIN': 'GB',
        'UK': 'GB',
        'UNITED STATES': 'US',
        'USA': 'US',
        'CANADA': 'CA',
        'AUSTRALIA': 'AU',
    };

    return countryMap[upper] || 'NL';
};
