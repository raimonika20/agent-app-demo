import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Button,
  DataTable,
  Modal,
  TextField,
  Select,
  BlockStack,
  Text,
  EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { useSubmit, useLoaderData } from "@remix-run/react";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Fetch regular products for bundle creation
  const productsResponse = await admin.graphql(
    `query getProducts {
      products(first: 20, query: "NOT tag:bundle") {
        edges {
          node {
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
      }
    }`
  );

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

  const productsJson = await productsResponse.json();
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
    products: productsJson.data.products.edges,
    bundles: bundlesWithProducts.filter(bundle => bundle.bundleProducts?.length > 0)
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const bundleData = JSON.parse(formData.get("bundleData"));

  console.log('Creating bundle with data:', bundleData);

  // Create bundle product
  const createProductResponse = await admin.graphql(
    `mutation createProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          metafield(namespace: "custom", key: "bundle_products") {
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          title: bundleData.name,
          descriptionHtml: bundleData.description,
          tags: ["bundle"],
          status: "ACTIVE",
          metafields: [
            {
              namespace: "custom",
              key: "bundle_products",
              type: "json",
              value: JSON.stringify({
                products: bundleData.products,
                discount: parseInt(bundleData.discount)
              })
            }
          ]
        }
      }
    }
  );

  const response = await createProductResponse.json();
  console.log('Bundle creation response:', response);

  if (response.data?.productCreate?.userErrors?.length > 0) {
    return json({ error: response.data.productCreate.userErrors[0].message }, { status: 400 });
  }

  // Return a redirect to force a page reload
  return json({ success: true, product: response.data.productCreate.product });
};

export default function BundleCreator() {
  const { products, bundles } = useLoaderData();
  const submit = useSubmit();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState(null);
  const [bundleName, setBundleName] = useState("");
  const [bundleDescription, setBundleDescription] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [discountPercentage, setDiscountPercentage] = useState("10");

  const handleCreateBundle = useCallback(() => {
    const bundleData = {
      name: bundleName,
      description: bundleDescription,
      products: selectedProducts,
      discount: parseInt(discountPercentage)
    };

    submit(
      { bundleData: JSON.stringify(bundleData) },
      { method: "post", replace: true }
    );

    setBundleName("");
    setBundleDescription("");
    setSelectedProducts([]);
    setDiscountPercentage("10");
    setIsModalOpen(false);
  }, [bundleName, bundleDescription, selectedProducts, discountPercentage, submit]);

  const rows = products.map(({ node }) => {
    const price = parseFloat(node.priceRangeV2.minVariantPrice.amount).toFixed(2);
    return [
      node.title,
      `$${price}`,
      <Button
        key={node.id}
        onClick={() => {
          if (!selectedProducts.includes(node.id)) {
            setSelectedProducts([...selectedProducts, node.id]);
          }
        }}
        disabled={selectedProducts.includes(node.id)}
      >
        Add to Bundle
      </Button>
    ];
  });

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

  const selectedProductRows = selectedProducts.map(productId => {
    const product = products.find(({ node }) => node.id === productId)?.node;
    if (!product) return null;

    const price = parseFloat(product.priceRangeV2.minVariantPrice.amount).toFixed(2);
    return [
      product.title,
      `$${price}`,
      <Button
        key={product.id}
        destructive
        onClick={() => setSelectedProducts(selectedProducts.filter(id => id !== productId))}
      >
        Remove
      </Button>
    ];
  }).filter(Boolean);

  const totalBundlePrice = selectedProductRows.reduce((sum, row) => {
    const price = parseFloat(row[1].replace('$', ''));
    return sum + price;
  }, 0);

  const discountedBundlePrice = totalBundlePrice * (1 - parseInt(discountPercentage) / 100);

  return (
    <Page
      title="Smart Bundle Creator"
      primaryAction={{
        content: "Create New Bundle",
        onAction: () => setIsModalOpen(true),
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Created Bundles section */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Created Bundles</Text>
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

            {/* Available Products section */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Available Products</Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "text"]}
                  headings={["Product", "Price", "Action"]}
                  rows={rows}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Create Bundle Modal */}
        <Modal
          open={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedProducts([]);
            setBundleName("");
            setBundleDescription("");
            setDiscountPercentage("10");
          }}
          title="Create New Bundle"
          primaryAction={{
            content: "Create Bundle",
            onAction: handleCreateBundle,
            disabled: selectedProducts.length === 0 || !bundleName
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => {
                setIsModalOpen(false);
                setSelectedProducts([]);
                setBundleName("");
                setBundleDescription("");
                setDiscountPercentage("10");
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Bundle Name"
                value={bundleName}
                onChange={setBundleName}
                autoComplete="off"
                required
              />
              <TextField
                label="Description"
                value={bundleDescription}
                onChange={setBundleDescription}
                multiline={4}
              />
              <Select
                label="Discount Percentage"
                options={["5", "10", "15", "20", "25"]}
                value={discountPercentage}
                onChange={setDiscountPercentage}
              />

              {selectedProductRows.length > 0 && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">Selected Products</Text>
                    <DataTable
                      columnContentTypes={["text", "numeric", "text"]}
                      headings={["Product", "Price", "Action"]}
                      rows={selectedProductRows}
                    />
                    <BlockStack gap="200">
                      <Text variant="bodySm">Total Price: ${totalBundlePrice.toFixed(2)}</Text>
                      <Text variant="bodyMd">Discounted Price: ${discountedBundlePrice.toFixed(2)}</Text>
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

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
      </Layout>
    </Page>
  );
}
