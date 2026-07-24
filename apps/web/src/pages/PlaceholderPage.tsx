import { ArrowLeft, Blocks } from "lucide-react";
import { Link } from "react-router-dom";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <section className="panel min-h-[60vh]"><div className="empty-state min-h-[50vh]"><span className="empty-icon"><Blocks size={24} /></span><p className="eyebrow-plain">Migration slice queued</p><h1 className="text-3xl font-semibold tracking-tight text-white">{title}</h1><p>{description}</p><Link to="/" className="secondary-button mt-5"><ArrowLeft size={15} />Back to overview</Link></div></section>;
}
