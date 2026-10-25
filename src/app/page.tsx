import BookingWizard from "@/components/BookingWizard";
import Link from "next/link";
import Image from "next/image";
import { FACILITY } from "@/lib/defaults";
import { upcomingPublicSessions, sessionLabel } from "@/lib/open-play";

export const revalidate = 60;

// Exact map pin. To move it: right-click the spot in Google Maps and copy the numbers.
const PIN = "6.625928,124.062926";
const GOOGLE_MAPS = `https://www.google.com/maps/dir/?api=1&destination=${PIN}`;
const WAZE = `https://waze.com/ul?ll=${PIN}&navigate=yes`;
const MAP_EMBED = `https://maps.google.com/maps?q=${PIN}&z=17&output=embed`;

function DirectionsButtons({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <a href={GOOGLE_MAPS} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-court px-4 py-2.5 text-sm font-bold text-white">
        📍 Google Maps
      </a>
      <a href={WAZE} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[#33CCFF] px-4
