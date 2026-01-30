/**
 * Skeleton placeholder for market/position cards during loading.
 */
export function SkeletonCard() {
  return (
    <div className="card bg-base-200 shadow-xl animate-pulse">
      <div className="card-body">
        <div className="flex justify-between items-start mb-2">
          <div className="h-5 bg-base-300 rounded w-3/4" />
          <div className="h-5 w-14 bg-base-300 rounded-full" />
        </div>
        <div className="space-y-2 mb-4">
          <div className="h-3 bg-base-300 rounded w-full" />
          <div className="h-3 bg-base-300 rounded w-2/3" />
        </div>
        <div className="flex gap-4 mb-4">
          <div className="h-8 bg-base-300 rounded w-16" />
          <div className="h-8 bg-base-300 rounded w-16" />
        </div>
        <div className="flex justify-between">
          <div className="h-3 bg-base-300 rounded w-24" />
          <div className="h-3 bg-base-300 rounded w-12" />
        </div>
        <div className="card-actions justify-end mt-4">
          <div className="h-8 bg-base-300 rounded w-24" />
        </div>
      </div>
    </div>
  );
}
