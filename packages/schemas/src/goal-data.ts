// Reference lists for the planned-expense forms (owner, 2026-10-26). Names only: no prices,
// no specifications. States and union territories are the complete list; cities, makes and
// models are suggestions written by hand (as of October 2026) and can go out of date, so
// the forms always accept a city, make or model that isn't listed.

/**
 * When each group of lists was last checked against its sources (docs/quarterly-list-refresh.md).
 * Not shown in the app.
 */
export const LISTS_REVIEWED_ON = {
  /** Bike, car and HMV makes and models. */
  vehicles: "2026-10-26",
  /** States and union territories, cities (countries come from region-data.ts). */
  places: "2026-10-26",
} as const;

/** India's 28 states and 8 union territories, in name order. */
export const INDIAN_STATES: readonly string[] = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

/** State and UT capitals plus larger cities and towns (suggestions; any city can be typed). */
export const INDIAN_CITIES: readonly string[] = [
  "Agartala", "Agra", "Ahmedabad", "Aizawl", "Ajmer", "Akola", "Aligarh", "Allahabad (Prayagraj)", "Alappuzha", "Amravati",
  "Amritsar", "Anand", "Asansol", "Aurangabad (Chhatrapati Sambhajinagar)", "Ayodhya", "Bareilly", "Belagavi", "Bengaluru",
  "Bhagalpur", "Bharuch", "Bhavnagar", "Bhilai", "Bhiwandi", "Bhopal", "Bhubaneswar", "Bikaner", "Bilaspur", "Bokaro",
  "Chandigarh", "Chennai", "Coimbatore", "Cuttack", "Darbhanga", "Davanagere", "Dehradun", "Delhi", "Dhanbad", "Dharamshala",
  "Dharwad", "Dibrugarh", "Dispur", "Durgapur", "Erode", "Faridabad", "Gandhinagar", "Gangtok", "Gaya", "Ghaziabad",
  "Gorakhpur", "Greater Noida", "Gulbarga (Kalaburagi)", "Guntur", "Gurugram", "Guwahati", "Gwalior", "Haldwani", "Haridwar",
  "Hisar", "Hosur", "Howrah", "Hubballi", "Hyderabad", "Imphal", "Indore", "Itanagar", "Jabalpur", "Jaipur", "Jalandhar",
  "Jalgaon", "Jammu", "Jamnagar", "Jamshedpur", "Jhansi", "Jodhpur", "Junagadh", "Kakinada", "Kannur", "Kanpur", "Karnal",
  "Kavaratti", "Kochi", "Kohima", "Kolhapur", "Kolkata", "Kollam", "Kota", "Kottayam", "Kozhikode", "Kurnool", "Leh",
  "Lucknow", "Ludhiana", "Madurai", "Malappuram", "Mangaluru", "Mathura", "Meerut", "Moradabad", "Mumbai", "Muzaffarnagar",
  "Muzaffarpur", "Mysuru", "Nagpur", "Nanded", "Nashik", "Navi Mumbai", "Nellore", "Noida", "Panaji", "Panipat", "Patiala",
  "Patna", "Puducherry", "Pune", "Raipur", "Rajahmundry", "Rajkot", "Ranchi", "Rohtak", "Rourkela", "Sagar", "Saharanpur",
  "Salem", "Sambalpur", "Sangli", "Satara", "Shillong", "Shimla", "Siliguri", "Silvassa", "Solapur", "Sonipat", "Srinagar",
  "Surat", "Thane", "Thanjavur", "Thiruvananthapuram", "Thrissur", "Tiruchirappalli", "Tirunelveli", "Tirupati", "Tiruppur",
  "Udaipur", "Ujjain", "Vadodara", "Varanasi", "Vasai-Virar", "Vellore", "Vijayawada", "Visakhapatnam", "Warangal",
];

export type VehicleCatalogue = Readonly<Record<string, readonly string[]>>;

/** Two-wheeler makes and models sold in India (suggestions). */
const BIKES: VehicleCatalogue = {
  Ather: ["450 Apex", "450S", "450X", "Rizta"],
  Bajaj: ["Avenger", "Chetak", "CT 110X", "Dominar 400", "Freedom 125", "Platina", "Pulsar 150", "Pulsar N160", "Pulsar N250", "Pulsar NS200"],
  "Harley-Davidson": ["X440"],
  Hero: ["Destini 125", "Glamour", "HF Deluxe", "Passion", "Pleasure+", "Splendor Plus", "Super Splendor", "Vida V2", "Xoom", "Xpulse 200", "Xtreme 125R", "Xtreme 160R"],
  Honda: ["Activa", "Activa 125", "Activa e", "CB350", "Dio", "H'ness CB350", "Hornet 2.0", "Shine", "Shine 100", "SP 125", "Unicorn"],
  Jawa: ["42", "350", "Perak"],
  Kawasaki: ["Ninja 300", "Ninja 650", "Z900"],
  KTM: ["125 Duke", "200 Duke", "250 Duke", "390 Adventure", "390 Duke", "RC 390"],
  "Ola Electric": ["Roadster", "S1 Air", "S1 Pro", "S1 X"],
  "Royal Enfield": ["Bullet 350", "Classic 350", "Continental GT 650", "Guerrilla 450", "Himalayan 450", "Hunter 350", "Interceptor 650", "Meteor 350", "Shotgun 650", "Super Meteor 650"],
  Suzuki: ["Access 125", "Avenis", "Burgman Street", "Gixxer", "Gixxer SF", "V-Strom SX"],
  Triumph: ["Scrambler 400 X", "Speed 400"],
  TVS: ["Apache RR 310", "Apache RTR 160", "Apache RTR 200 4V", "iQube", "Jupiter", "Ntorq 125", "Radeon", "Raider 125", "Ronin", "Sport", "XL100"],
  Yamaha: ["Aerox 155", "Fascino 125", "FZ-S", "FZ-X", "MT-15", "R15", "RayZR 125"],
  Yezdi: ["Adventure", "Roadster", "Scrambler"],
};

/** Car makes and their Indian models (suggestions). */
const CARS: VehicleCatalogue = {
  Audi: ["A4", "A6", "e-tron GT", "Q3", "Q5", "Q7", "Q8"],
  BMW: ["2 Series Gran Coupe", "3 Series", "5 Series", "7 Series", "i4", "i7", "iX1", "X1", "X3", "X5", "X7"],
  BYD: ["Atto 3", "eMax 7", "Seal", "Sealion 7"],
  Citroen: ["Aircross", "Basalt", "C3", "C5 Aircross", "eC3"],
  Honda: ["Amaze", "City", "City e:HEV", "Elevate"],
  Hyundai: ["Alcazar", "Aura", "Creta", "Creta Electric", "Exter", "Grand i10 Nios", "i20", "Ioniq 5", "Tucson", "Venue", "Verna"],
  Jeep: ["Compass", "Grand Cherokee", "Meridian", "Wrangler"],
  Kia: ["Carens", "Carnival", "EV6", "EV9", "Seltos", "Sonet", "Syros"],
  "Land Rover": ["Defender", "Discovery Sport", "Range Rover", "Range Rover Evoque", "Range Rover Sport", "Range Rover Velar"],
  Mahindra: ["BE 6", "Bolero", "Bolero Neo", "Scorpio Classic", "Scorpio N", "Thar", "Thar Roxx", "XEV 9e", "XUV 3XO", "XUV700"],
  "Maruti Suzuki": ["Alto K10", "Baleno", "Brezza", "Celerio", "Ciaz", "Dzire", "e Vitara", "Eeco", "Ertiga", "Fronx", "Grand Vitara", "Ignis", "Invicto", "Jimny", "S-Presso", "Swift", "Wagon R", "XL6"],
  "Mercedes-Benz": ["A-Class Limousine", "C-Class", "E-Class", "EQS", "GLA", "GLC", "GLE", "GLS", "S-Class"],
  MG: ["Astor", "Comet EV", "Gloster", "Hector", "Hector Plus", "Windsor EV", "ZS EV"],
  Nissan: ["Magnite"],
  Renault: ["Kiger", "Kwid", "Triber"],
  Skoda: ["Kodiaq", "Kushaq", "Kylaq", "Slavia", "Superb"],
  Tata: ["Altroz", "Curvv", "Curvv EV", "Harrier", "Harrier EV", "Nexon", "Nexon EV", "Punch", "Punch EV", "Safari", "Tiago", "Tiago EV", "Tigor"],
  Toyota: ["Camry", "Fortuner", "Fortuner Legender", "Glanza", "Hilux", "Innova Crysta", "Innova Hycross", "Rumion", "Urban Cruiser Hyryder", "Urban Cruiser Taisor", "Vellfire"],
  Volkswagen: ["Taigun", "Tiguan", "Virtus"],
  Volvo: ["XC40 Recharge", "XC60", "XC90"],
};

/** Heavy motor vehicle (trucks, buses) makes and ranges sold in India (suggestions). */
const HMVS: VehicleCatalogue = {
  "Ashok Leyland": ["Boss", "Captain", "Dost", "Ecomet", "Partner", "Viking"],
  BharatBenz: ["1015R", "1217C", "2823C", "3528C"],
  Eicher: ["Pro 2000", "Pro 3000", "Pro 6000", "Skyline"],
  Mahindra: ["Blazo X", "Furio", "Jayo"],
  Scania: ["G series", "P series"],
  "Tata Motors": ["LPT", "Prima", "Signa", "Starbus", "Ultra"],
  Volvo: ["9600", "FM", "FMX"],
};

export const VEHICLE_CATALOGUE: Readonly<Record<"bike" | "car" | "hmv", VehicleCatalogue>> = { bike: BIKES, car: CARS, hmv: HMVS };

/** Makes for a kind of vehicle, in name order. */
export const vehicleMakes = (kind: "bike" | "car" | "hmv"): string[] => Object.keys(VEHICLE_CATALOGUE[kind]).sort((a, b) => a.localeCompare(b));

/** Listed models for a make (empty for a make that isn't listed). */
export const vehicleModels = (kind: "bike" | "car" | "hmv", make: string): readonly string[] => VEHICLE_CATALOGUE[kind][make] ?? [];
