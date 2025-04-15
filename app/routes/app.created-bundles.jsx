import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Button,
  DataTable,
  Modal,
  BlockStack,
  Text,
  EmptyState,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { useLoaderData } from "@remix-run/react";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Fetch bundle products with their metafields
  const bundlesResponse = await admin.graphql(
    `query getBundles {
      products(first: 20, query: "tag:bundle") {
        edges {
          node {
            id
            title
            description
            metafield(namespace: "custom", key: "bundle_products") {
              value
            }
          }
        }
      }
    }`
  );

  const bundlesJson = await bundlesResponse.json();

  // Process bundles to include their products
  const bundlesWithProducts = await Promise.all(
    bundlesJson.data.products.edges.map(async ({ node }) => {
      const metafieldValue = node.metafield?.value;
      if (metafieldValue) {
        try {
          const bundleData = JSON.parse(metafieldValue);

          // Fetch details for each product in the bundle
          const bundleProductsQuery = await admin.graphql(
            `query getProducts($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  title
                  priceRangeV2 {
                    minVariantPrice {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }`,
            {
              variables: {
                ids: bundleData.products
              }
            }
          );

          const bundleProductsJson = await bundleProductsQuery.json();

          return {
            ...node,
            bundleProducts: bundleProductsJson.data.nodes,
            discount: bundleData.discount
          };
        } catch (error) {
          console.error('Error processing bundle:', error);
          return node;
        }
      }
      return node;
    })
  );

  return json({
    bundles: bundlesWithProducts.filter(bundle => bundle.bundleProducts?.length > 0)
  });
};

export default function CreatedBundles() {
  const { bundles } = useLoaderData();
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState(null);

  const bundleRows = bundles.map((bundle) => {
    const productsCount = bundle.bundleProducts?.length || 0;
    const totalPrice = bundle.bundleProducts?.reduce((sum, product) => {
      return sum + parseFloat(product.priceRangeV2.minVariantPrice.amount);
    }, 0) || 0;

    const discountedPrice = totalPrice * (1 - (bundle.discount || 0) / 100);

    return [
      bundle.title,
      `${productsCount} items`,
      `$${discountedPrice.toFixed(2)}`,
      <Button
        key={bundle.id}
        onClick={() => {
          setSelectedBundle(bundle);
          setIsViewModalOpen(true);
        }}
      >
        View Details
      </Button>
    ];
  });

  return (
    <Page
      title="Created Bundles"
      primaryAction={{
        content: "Create New Bundle",
        url: "/app/bundles",
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">All Bundles</Text>
              {bundleRows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "text"]}
                  headings={["Bundle Name", "Products", "Price", "Action"]}
                  rows={bundleRows}
                />
              ) : (
                <EmptyState
                  heading="No bundles created yet"
                  image=""
                >
                  <p>Create your first bundle by clicking the "Create New Bundle" button above.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* View Bundle Modal */}
      <Modal
        open={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false);
          setSelectedBundle(null);
        }}
        title={selectedBundle?.title || "Bundle Details"}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {selectedBundle?.description && (
              <Text variant="bodyMd">{selectedBundle.description}</Text>
            )}

            <Text as="h3" variant="headingMd">Bundle Products</Text>
            {selectedBundle?.bundleProducts?.map((product) => (
              <Card key={product.id}>
                <BlockStack gap="200">
                  <Text variant="bodyMd" as="span">{product.title}</Text>
                  <Text variant="bodySm" as="span">
                    Price: ${parseFloat(product.priceRangeV2.minVariantPrice.amount).toFixed(2)}
                  </Text>
                </BlockStack>
              </Card>
            ))}

            {selectedBundle?.bundleProducts && (
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm">Bundle Discount: {selectedBundle.discount}%</Text>
                  <Text variant="bodySm">
                    Original Total: $
                    {selectedBundle.bundleProducts.reduce(
                      (sum, product) => sum + parseFloat(product.priceRangeV2.minVariantPrice.amount),
                      0
                    ).toFixed(2)}
                  </Text>
                  <Text variant="headingSm">
                    Final Price: $
                    {(
                      selectedBundle.bundleProducts.reduce(
                        (sum, product) => sum + parseFloat(product.priceRangeV2.minVariantPrice.amount),
                        0
                      ) * (1 - selectedBundle.discount / 100)
                    ).toFixed(2)}
                  </Text>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
