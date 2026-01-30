import { NextSeo } from 'next-seo';
import type { NextPageWithLayout } from '@/types';
import Layout from '@/layouts/_layout';
import { useIsMounted } from '@/hooks/use-is-mounted';



const ErrorPage: NextPageWithLayout = () => {
  const isMounted = useIsMounted();
  
  return (
    <>
      <NextSeo
        title="404 Error! No Result Found"
        description="WhisperMarket – private prediction markets on Aleo"
      />

      <div className="flex max-w-full flex-col items-center justify-center text-center">
        <div className="relative w-52 max-w-full sm:w-[400px] xl:w-[450px] 3xl:w-[500px]">
        </div>

        <h2 className="mt-5 mb-2 text-base font-medium uppercase tracking-wide text-gray-900 dark:text-white sm:mt-10 sm:mb-4 sm:text-xl 3xl:mt-12 3xl:text-2xl">
          Error! No Result Found
        </h2>
        <p className="mb-4 max-w-full text-xs leading-loose tracking-tight text-gray-600 dark:text-gray-400 sm:mb-6 sm:w-[430px] sm:text-sm sm:leading-loose">
          Sorry, the page you are looking for might be renamed, removed, or
          might never exist.
        </p>
   


      </div>
    </>
  );
};

ErrorPage.getLayout = function getLayout(page) {
  return (
    <Layout>
      {page}
    </Layout>
  );
};

export default ErrorPage;
