// Master list of merchant business types offered during store onboarding.
// Seeded via upsert on startup — add entries here and restart to sync.
// Existing rows are never renamed or deleted, so businesses already linked to
// a type keep working; the list only ever grows.

export const BUSINESS_TYPE_SEED = [
  // ── Grocery & daily needs ─────────────────────────────────────────────
  'Grocery Store',
  'Supermarket',
  'Hypermarket',
  'Kirana / General Store',
  'Departmental Store',
  'Convenience Store',
  'Organic & Natural Store',
  'Wholesale / Cash & Carry',

  // ── Fresh food ────────────────────────────────────────────────────────
  'Fruit & Vegetable Shop',
  'Dairy Boutique',
  'Bakery',
  'Cake Shop & Confectionery',
  'Sweet Shop',
  'Meat & Poultry Shop',
  'Fish & Seafood Shop',
  'Eggs & Frozen Foods',
  'Dry Fruits & Nuts Store',
  'Spices & Masala Store',
  'Rice, Atta & Pulses Store',
  'Oil & Ghee Store',

  // ── Food service ──────────────────────────────────────────────────────
  'Restaurant',
  'Cloud Kitchen',
  'Cafe & Coffee Shop',
  'Tea Stall / Chai Point',
  'Juice & Smoothie Bar',
  'Ice Cream Parlour',
  'Fast Food Outlet',
  'Tiffin & Home Food Service',
  'Catering Service',
  'Food Truck',

  // ── Health & wellness ─────────────────────────────────────────────────
  'Pharmacy / Medical Store',
  'Ayurvedic & Herbal Store',
  'Health Supplements Store',
  'Surgical & Medical Equipment',
  'Optical Store',
  'Diagnostic Lab Collection Centre',
  'Clinic',
  'Veterinary Clinic',
  'Fitness & Gym',
  'Spa & Wellness Centre',

  // ── Personal care & lifestyle ─────────────────────────────────────────
  'Cosmetics & Beauty Store',
  'Salon & Barber Shop',
  'Perfume Store',
  'Baby Care & Kids Store',

  // ── Home & household ──────────────────────────────────────────────────
  'Household & Cleaning Supplies',
  'Home Decor & Furnishing',
  'Furniture Store',
  'Kitchenware & Utensils',
  'Crockery & Glassware',
  'Plastic & Storage Products',
  'Hardware & Sanitary Store',
  'Paint & Building Materials',
  'Electrical & Lighting Store',
  'Plumbing Supplies',

  // ── Electronics & appliances ──────────────────────────────────────────
  'Mobile & Accessories',
  'Electronics Store',
  'Home Appliances Store',
  'Computer & IT Store',
  'Repair & Service Centre',

  // ── Fashion & accessories ─────────────────────────────────────────────
  'Clothing & Apparel',
  'Footwear Store',
  'Jewellery Store',
  'Imitation Jewellery',
  'Bags & Luggage',
  'Watches & Eyewear',
  'Tailoring & Boutique',
  'Fabric & Textile Store',

  // ── Speciality retail ─────────────────────────────────────────────────
  'Stationery & Books',
  'Gift & Novelty Shop',
  'Toys & Games Store',
  'Sports & Fitness Equipment',
  'Musical Instruments',
  'Pet Store & Supplies',
  'Plants & Nursery',
  'Florist',
  'Pooja & Religious Store',
  'Paan Shop',
  'Tobacco & Cigarette Shop',
  'Liquor Store',
  'Agriculture & Seeds Store',
  'Automobile Parts & Accessories',
  'Cycle Store',
  'Fuel & Gas Agency',
  'Printing & Xerox',
  'Mobile Recharge & Bill Payments',

  // ── Services ──────────────────────────────────────────────────────────
  'Laundry & Dry Cleaning',
  'Courier & Logistics',
  'Packers & Movers',
  'Event & Party Supplies',
  'Photography Studio',
  'Travel & Ticketing',
  'Real Estate',
  'Education & Coaching',
  'Professional Services',
  'Cleaning & Pest Control',
  'Home Services & Repairs',

  // ── Fallback ──────────────────────────────────────────────────────────
  'Other',
];
